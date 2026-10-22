# Export Prime Service : Supabase (Postgres) → SQLite compatible Turso.
#
# Rôle (mode "veille") : copier le schéma public et les données actuelles de
# Supabase sans modifier le site actif. Résultats (dans ce dossier) :
#   - prime-service-veille.db  : fichier SQLite prêt pour Turso (@libsql/client)
#   - prime-service-veille.sql : le même contenu en SQL texte
#
# Utilisation :
#   python3 exporter-supabase.py <fichier-jeton> <project-ref>
#   (le fichier jeton contient un jeton Supabase sbp_... ; il n'est jamais
#    affiché ni enregistré dans le dépôt)
# Idempotent : la base de veille est reconstruite à chaque exécution.

import datetime
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

TABLES = [
    "parametres",
    "produits",
    "commandes",
    "notifications_generales",
    "notifications_boutiquiers",
    "suivis_notifications_boutiquiers",
    "abonnements_push",
    "traitements_images_produits",
    "site_visites",
]

DDL = """
CREATE TABLE IF NOT EXISTS parametres (
  id INTEGER PRIMARY KEY,
  en_pause INTEGER DEFAULT 0,
  raison_pause TEXT DEFAULT '',
  categories_masquees TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS produits (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  nom TEXT,
  prix INTEGER,
  categorie_id TEXT,
  sous_categorie_id TEXT,
  adresse TEXT,
  lat REAL,
  lng REAL,
  image_url TEXT,
  telephone TEXT,
  stock INTEGER DEFAULT 1,
  nom_boutique TEXT,
  masque INTEGER DEFAULT 0,
  telephone_boutique TEXT,
  commission INTEGER DEFAULT 300,
  nom_boutiquier TEXT
);
CREATE INDEX IF NOT EXISTS produits_nom_boutiquier_idx ON produits (nom_boutiquier);

CREATE TABLE IF NOT EXISTS commandes (
  id TEXT PRIMARY KEY,
  nom_client TEXT,
  telephone_client TEXT,
  paiement TEXT,
  lat_client REAL,
  lng_client REAL,
  articles TEXT,
  total INTEGER,
  created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  quartier_client TEXT,
  precision_livraison TEXT,
  item_id INTEGER
);

CREATE TABLE IF NOT EXISTS notifications_generales (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  titre TEXT NOT NULL,
  url TEXT,
  statut TEXT DEFAULT 'en_attente',
  prochaine_tentative TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  envoyee_at TEXT,
  created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  tentative INTEGER DEFAULT 0,
  max_tentatives INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notifications_boutiquiers (
  id TEXT PRIMARY KEY,
  commande_id TEXT,
  nom_boutique TEXT,
  telephone_boutique TEXT,
  message TEXT,
  statut TEXT DEFAULT 'en_attente',
  tentative INTEGER DEFAULT 0,
  prochaine_tentative TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  ack_token TEXT,
  acknowledged_at TEXT,
  escalated_at TEXT,
  last_error TEXT,
  read_started_at TEXT,
  relance_generale INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_boutiquiers_ack_token_idx
  ON notifications_boutiquiers (ack_token) WHERE ack_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS suivis_notifications_boutiquiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id TEXT,
  telephone_boutique TEXT NOT NULL,
  tentative INTEGER DEFAULT 1,
  statut TEXT DEFAULT 'en_attente',
  created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS abonnements_push (
  id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  telephone_boutique TEXT,
  relance_generale INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_visites (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  visit_day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '/'
);
CREATE INDEX IF NOT EXISTS site_visites_day_hash_idx ON site_visites (visit_day, visitor_hash);
CREATE INDEX IF NOT EXISTS site_visites_created_at_idx ON site_visites (created_at);

CREATE TABLE IF NOT EXISTS traitements_images_produits (
  id INTEGER PRIMARY KEY,
  produit_id INTEGER NOT NULL,
  source_image_url TEXT NOT NULL,
  optimized_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'en_attente',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  source_deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS traitements_images_produits_produit_id_source_image_url_key
  ON traitements_images_produits (produit_id, source_image_url);
CREATE INDEX IF NOT EXISTS traitements_images_produits_pending_idx
  ON traitements_images_produits (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS _veille_meta (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
"""


def post_sql(token, ref, query):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as rep:
            return json.load(rep)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Lecture Supabase impossible : HTTP {exc.code} {exc.read().decode()[:300]}")


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, (dict, list)):
        return sql_value(json.dumps(value, ensure_ascii=False))
    return "'" + str(value).replace("'", "''") + "'"


def exporter_table(db, token, ref, table):
    lignes = []
    depart = 0
    while True:
        res = post_sql(token, ref,
                       f"SELECT row_to_json(t) AS r FROM public.{table} t "
                       f"LIMIT 1000 OFFSET {depart};")
        if not isinstance(res, list):
            raise SystemExit(f"Réponse inattendue pour {table}.")
        lignes.extend(l["r"] for l in res)
        if len(res) < 1000:
            break
        depart += 1000

    colonnes = post_sql(token, ref,
                        "SELECT column_name FROM information_schema.columns "
                        f"WHERE table_schema='public' AND table_name='{table}' "
                        "ORDER BY ordinal_position;")
    noms = [c["column_name"] for c in colonnes]

    def transformer(ligne, colonne):
        valeur = ligne.get(colonne)
        if isinstance(valeur, (dict, list)):
            return json.dumps(valeur, ensure_ascii=False)
        return valeur

    entetes = ",".join(noms)
    questions = ",".join("?" * len(noms))
    db.executemany(
        f"INSERT INTO {table} ({entetes}) VALUES ({questions})",
        [tuple(transformer(l, n) for n in noms) for l in lignes],
    )

    sql = []
    for l in lignes:
        valeurs = ", ".join(
            sql_value(json.dumps(l.get(n), ensure_ascii=False)
                      if isinstance(l.get(n), (dict, list)) else l.get(n))
            for n in noms
        )
        sql.append(f"INSERT INTO {table} ({entetes}) VALUES ({valeurs});")
    return len(lignes), sql


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: python3 exporter-supabase.py <fichier-jeton> <project-ref>")
    jeton = open(sys.argv[1], "rb").read().decode().strip()
    ref = sys.argv[2]
    if not jeton.startswith("sbp_"):
        raise SystemExit("Le fichier jeton ne contient pas un jeton sbp_ — fichier incorrect ?")

    ici = os.path.dirname(os.path.abspath(__file__))
    chemin_db = os.path.join(ici, "prime-service-veille.db")
    chemin_sql = os.path.join(ici, "prime-service-veille.sql")
    for chemin in (chemin_db, chemin_sql):
        if os.path.exists(chemin):
            os.remove(chemin)

    db = sqlite3.connect(chemin_db)
    db.executescript(DDL)

    texte = ["-- Prime Service — données de veille copiées depuis Supabase (" + ref + ")",
             "-- export du " + datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
             "",
             "-- SCHÉMA (SQLite/libSQL, adapté du schéma public Supabase)", DDL, "",
             "-- DONNÉES", "BEGIN TRANSACTION;"]
    bilan = {}
    for table in TABLES:
        n, inserts = exporter_table(db, jeton, ref, table)
        texte.append(f"-- {table} : {n} lignes")
        texte.extend(inserts)
        texte.append("")
        bilan[table] = n
        print(f"{table} : {n} lignes copiées")

    db.executemany("INSERT INTO _veille_meta (cle, valeur) VALUES (?, ?)",
                   [("source", "supabase:" + ref),
                    ("export_date", datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"))]
                   + [(f"count:{t}", str(bilan[t])) for t in TABLES])
    db.commit()

    exactes = post_sql(jeton, ref,
                       "SELECT (SELECT COUNT(*) FROM public.parametres) AS parametres,"
                       "(SELECT COUNT(*) FROM public.produits) AS produits,"
                       "(SELECT COUNT(*) FROM public.commandes) AS commandes,"
                       "(SELECT COUNT(*) FROM public.abonnements_push) AS abonnements_push,"
                       "(SELECT COUNT(*) FROM public.site_visites) AS site_visites,"
                       "(SELECT COUNT(*) FROM public.traitements_images_produits) AS traitements_images_produits;")
    if isinstance(exactes, list) and exactes:
        print("Décomptes exacts côté Supabase :", json.dumps(exactes[0], ensure_ascii=False))

    taille_mo = os.path.getsize(chemin_db) / (1024 * 1024)
    print(f"\nBase de veille écrite : {chemin_db} ({taille_mo:.2f} Mo)")
    print(f"SQL texte écrit       : {chemin_sql}")

    db.close()


if __name__ == "__main__":
    main()
