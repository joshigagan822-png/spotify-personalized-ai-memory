"""Build a read-only search index of public Spotify recording metadata."""
import csv
import io
import sqlite3
import sys
import tempfile
import unicodedata
import urllib.request
from pathlib import Path

SOURCE = 'https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset/resolve/635b034f69257814eff850a5c2b3346fe458134f/dataset.csv'
destination = Path(sys.argv[1])
def normalize(value):
    return ' '.join(unicodedata.normalize('NFKD', value).casefold().split())

with tempfile.TemporaryDirectory(dir=destination.parent) as folder:
    output = Path(folder) / 'catalog.sqlite'
    with sqlite3.connect(output) as db, urllib.request.urlopen(SOURCE, timeout=90) as response:
        rows = csv.DictReader(io.TextIOWrapper(response, encoding='utf-8-sig', newline=''))
        db.execute('CREATE TABLE tracks(id TEXT PRIMARY KEY, title TEXT, artist TEXT, normalized TEXT, popularity INTEGER)')
        for row in rows:
            track_id = row['track_id']
            title = row['track_name']
            if len(track_id) == 22 and track_id.isalnum() and title:
                db.execute('INSERT OR IGNORE INTO tracks VALUES (?,?,?,?,?)',
                           (track_id, title, row['artists'].replace(';', ', '), normalize(title), int(row['popularity'])))
        count = db.execute('SELECT count(*) FROM tracks').fetchone()[0]
        if count < 50000:
            raise ValueError('Incomplete Spotify catalog download')
        db.execute("CREATE VIRTUAL TABLE lookup USING fts5(title,artist,content='tracks',content_rowid='rowid')")
        db.execute("INSERT INTO lookup(lookup) VALUES('rebuild')")
    output.replace(destination)
    print(f'Indexed {count} unique recordings')
