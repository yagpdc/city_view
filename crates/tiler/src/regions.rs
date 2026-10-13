//! Contagem por região de verdade (estado, município…): cada ponto cai num polígono de uma malha (GeoJSON)
//! e as contagens por categoria vão nos metadados do PMTiles. O mapa desenha a malha com esses números.
//!
//! Os polígonos são projetados para as mesmas coordenadas de mundo dos pontos (Web Mercator, 32 bits) e
//! indexados numa grade; o teste é par-ímpar sobre todos os anéis (buracos inclusive).

use std::collections::HashMap;

use rayon::prelude::*;
use serde_json::{Map, Value, json};

use crate::{mercator, table::{NO_CATEGORY, Table}};

/// Lado da célula da grade de busca, em unidades de mundo (2^20 ≈ 10 km no equador).
const CELL_BITS: u32 = 20;

struct Polygon {
    region: u32,
    rings: Vec<Vec<(f64, f64)>>,
    bbox: [f64; 4],
}

/// Uma malha (ex.: "uf", "mun"): códigos e polígonos, pronta para localizar pontos.
pub struct RegionLevel {
    pub id: String,
    codes: Vec<String>,
    polygons: Vec<Polygon>,
    grid: HashMap<(u32, u32), Vec<u32>>,
}

fn ring_from(value: &Value) -> Option<Vec<(f64, f64)>> {
    let ring: Vec<(f64, f64)> = value
        .as_array()?
        .iter()
        .filter_map(|p| {
            let p = p.as_array()?;
            Some(mercator::project_f64(p.first()?.as_f64()?, p.get(1)?.as_f64()?))
        })
        .collect();
    (ring.len() >= 3).then_some(ring)
}

impl RegionLevel {
    /// Lê uma FeatureCollection; `code_prop` é a propriedade com o código da região (ex.: "codigo").
    pub fn from_geojson(id: &str, json: &str, code_prop: &str) -> Result<Self, String> {
        let fc: Value = serde_json::from_str(json).map_err(|e| format!("malha {id}: {e}"))?;
        let features = fc.get("features").and_then(Value::as_array).ok_or_else(|| format!("malha {id}: sem features"))?;
        let mut codes = Vec::new();
        let mut polygons = Vec::new();
        for f in features {
            let Some(code) = f.pointer(&format!("/properties/{code_prop}")).map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            }) else {
                continue;
            };
            let Some(geometry) = f.get("geometry") else { continue };
            let coords = geometry.get("coordinates");
            let polys: Vec<&Value> = match geometry.get("type").and_then(Value::as_str) {
                Some("Polygon") => coords.into_iter().collect(),
                Some("MultiPolygon") => coords.and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default(),
                _ => continue,
            };
            let region = codes.len() as u32;
            codes.push(code);
            for poly in polys {
                let rings: Vec<Vec<(f64, f64)>> = poly.as_array().map(|r| r.iter().filter_map(ring_from).collect()).unwrap_or_default();
                if rings.is_empty() {
                    continue;
                }
                let bbox = rings[0].iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |b, &(x, y)| [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)]);
                polygons.push(Polygon { region, rings, bbox });
            }
        }
        let mut grid: HashMap<(u32, u32), Vec<u32>> = HashMap::new();
        let cell = |v: f64| (v.max(0.0) as u64 >> CELL_BITS) as u32;
        for (i, p) in polygons.iter().enumerate() {
            for cx in cell(p.bbox[0])..=cell(p.bbox[2]) {
                for cy in cell(p.bbox[1])..=cell(p.bbox[3]) {
                    grid.entry((cx, cy)).or_default().push(i as u32);
                }
            }
        }
        Ok(RegionLevel { id: id.to_owned(), codes, polygons, grid })
    }

    /// Índice da região que contém o ponto (coordenadas de mundo).
    fn locate(&self, x: f64, y: f64) -> Option<u32> {
        let key = ((x as u64 >> CELL_BITS) as u32, (y as u64 >> CELL_BITS) as u32);
        self.grid.get(&key)?.iter().map(|&i| &self.polygons[i as usize]).find_map(|p| {
            if x < p.bbox[0] || x > p.bbox[2] || y < p.bbox[1] || y > p.bbox[3] {
                return None;
            }
            let mut inside = false;
            for ring in &p.rings {
                let mut j = ring.len() - 1;
                for i in 0..ring.len() {
                    let (xi, yi) = ring[i];
                    let (xj, yj) = ring[j];
                    if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
                        inside = !inside;
                    }
                    j = i;
                }
            }
            inside.then_some(p.region)
        })
    }
}

/// `{ "<nível>": { "<código>": [total, c0, c1, …] } }` só com as regiões que têm algum ponto.
pub fn count(levels: &[RegionLevel], t: &Table) -> Value {
    let k = t.categories.len();
    let mut out = Map::new();
    for level in levels {
        let width = 1 + k;
        let counts = (0..t.len())
            .into_par_iter()
            .fold(
                || vec![0u32; level.codes.len() * width],
                |mut acc, i| {
                    if let Some(r) = level.locate(t.x[i] as f64, t.y[i] as f64) {
                        let base = r as usize * width;
                        acc[base] += 1;
                        let c = t.category[i];
                        if c != NO_CATEGORY && (c as usize) < k {
                            acc[base + 1 + c as usize] += 1;
                        }
                    }
                    acc
                },
            )
            .reduce(
                || vec![0u32; level.codes.len() * width],
                |mut a, b| {
                    a.iter_mut().zip(b).for_each(|(x, y)| *x += y);
                    a
                },
            );
        let mut regions = Map::new();
        for (r, code) in level.codes.iter().enumerate() {
            let row = &counts[r * width..(r + 1) * width];
            if row[0] > 0 {
                regions.insert(code.clone(), json!(row));
            }
        }
        out.insert(level.id.clone(), Value::Object(regions));
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localiza_ponto_no_poligono_com_buraco() {
        let json = r#"{"type":"FeatureCollection","features":[
          {"type":"Feature","properties":{"codigo":"A"},"geometry":{"type":"Polygon","coordinates":[[[-47,-24],[-46,-24],[-46,-23],[-47,-23],[-47,-24]],[[-46.6,-23.6],[-46.4,-23.6],[-46.4,-23.4],[-46.6,-23.4],[-46.6,-23.6]]]}},
          {"type":"Feature","properties":{"codigo":35},"geometry":{"type":"MultiPolygon","coordinates":[[[[-46.6,-23.6],[-46.4,-23.6],[-46.4,-23.4],[-46.6,-23.4],[-46.6,-23.6]]]]}}
        ]}"#;
        let level = RegionLevel::from_geojson("t", json, "codigo").expect("malha");
        let at = |lon: f64, lat: f64| {
            let (x, y) = mercator::project_f64(lon, lat);
            level.locate(x, y).map(|r| level.codes[r as usize].clone())
        };
        assert_eq!(at(-46.9, -23.8).as_deref(), Some("A"));
        assert_eq!(at(-46.5, -23.5).as_deref(), Some("35"), "dentro do buraco de A, na região 35");
        assert_eq!(at(-40.0, -10.0), None);
    }
}
