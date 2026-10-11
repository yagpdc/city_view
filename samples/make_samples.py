"""Gera CSVs de exemplo para testar a importação.

- samples/lojas-exemplo.csv          3 mil lojas, estilo Excel brasileiro (; , decimal, Latin-1), com erros
- data/out/samples/pontos-500k.csv   500 mil pontos, UTF-8 com vírgula (teste de desempenho)
"""

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
random.seed(7)

CIDADES = [
    ("São Paulo", "SP", -23.55, -46.63, 0.12),
    ("Rio de Janeiro", "RJ", -22.91, -43.20, 0.10),
    ("Belo Horizonte", "MG", -19.92, -43.94, 0.07),
    ("Curitiba", "PR", -25.43, -49.27, 0.07),
    ("Salvador", "BA", -12.97, -38.50, 0.07),
    ("Recife", "PE", -8.05, -34.90, 0.05),
    ("Porto Alegre", "RS", -30.03, -51.23, 0.07),
    ("Goiânia", "GO", -16.69, -49.25, 0.06),
]
CATEGORIAS = ["Farmácia", "Mercado", "Padaria", "Academia", "Pet shop"]
NOMES = ["Central", "Bom Preço", "Vila", "Estrela", "São Jorge", "Esperança", "Jardim", "Nova Era", "Ipê", "Aurora"]


def br(x: float, casas: int) -> str:
    return f"{x:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def lojas() -> None:
    path = ROOT / "lojas-exemplo.csv"
    with path.open("w", encoding="windows-1252", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Código", "Nome da loja", "Categoria", "Cidade", "UF", "Faturamento mensal (R$)", "Abertura", "Latitude", "Longitude"])
        for i in range(1, 3001):
            cidade, uf, lat0, lon0, raio = random.choice(CIDADES)
            cat = random.choices(CATEGORIAS, weights=[3, 4, 3, 1, 2])[0]
            lat = lat0 + random.gauss(0, raio)
            lon = lon0 + random.gauss(0, raio)
            fat = random.lognormvariate(11, 0.6)
            abertura = f"{random.randint(1, 28):02d}/{random.randint(1, 12):02d}/{random.randint(1995, 2025)}"
            lat_s, lon_s = br(lat, 6).replace(".", ""), br(lon, 6).replace(".", "")
            if i % 211 == 0:
                lat_s, lon_s = "", ""          # sem coordenada
            elif i % 307 == 0:
                lat_s = "N/D"                  # texto no lugar do número
            elif i % 401 == 0:
                lat_s, lon_s = "0", "0"        # coordenada impossível
            w.writerow([f"L{i:05d}", f"{cat} {random.choice(NOMES)} {i}", cat, cidade, uf, br(fat, 2), abertura, lat_s, lon_s])
    print(f"{path} ({path.stat().st_size / 1e3:.0f} KB)")


def grande() -> None:
    path = ROOT.parent / "data" / "out" / "samples" / "pontos-500k.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "tipo", "valor", "lat", "lon"])
        for i in range(500_000):
            _, _, lat0, lon0, raio = random.choice(CIDADES)
            w.writerow([i, random.choice("ABCDE"), round(random.random() * 1000, 2),
                        round(lat0 + random.gauss(0, raio * 2), 6), round(lon0 + random.gauss(0, raio * 2), 6)])
    print(f"{path} ({path.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    lojas()
    grande()
