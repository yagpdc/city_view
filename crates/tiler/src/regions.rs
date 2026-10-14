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
/// Distância máxima até o contorno para um ponto de fora entrar na região (2^19 ≈ 5 km no equador).
const NEAR_LIMIT: f64 = (1u64 << 19) as f64;

/// Distância² de um ponto a um segmento.
fn segment_dist2(x: f64, y: f64, (ax, ay): (f64, f64), (bx, by): (f64, f64)) -> f64 {
    let (dx, dy) = (bx - ax, by - ay);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 { (((x - ax) * dx + (y - ay) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
    let (px, py) = (ax + t * dx - x, ay + t * dy - y);
    px * px + py * py
}

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

    /// Região do ponto: a que o contém ou, fora de todas (malha simplificada corta o litoral e as divisas), a de
    /// contorno mais próximo até NEAR_LIMIT.
    fn locate(&self, x: f64, y: f64) -> Option<u32> {
        self.containing(x, y).or_else(|| self.nearest(x, y))
    }

    fn nearest(&self, x: f64, y: f64) -> Option<u32> {
        let (cx, cy) = ((x as u64 >> CELL_BITS) as i64, (y as u64 >> CELL_BITS) as i64);
        let mut best: Option<(f64, u32)> = None;
        let mut seen = std::collections::HashSet::new();
        for dx in -1..=1 {
            for dy in -1..=1 {
                let (gx, gy) = (cx + dx, cy + dy);
                if gx < 0 || gy < 0 {
                    continue;
                }
                for &i in self.grid.get(&(gx as u32, gy as u32)).into_iter().flatten() {
                    if !seen.insert(i) {
                        continue;
                    }
                    let p = &self.polygons[i as usize];
                    for ring in &p.rings {
                        for w in ring.windows(2) {
                            let d = segment_dist2(x, y, w[0], w[1]);
                            if d < NEAR_LIMIT * NEAR_LIMIT && best.is_none_or(|(b, _)| d < b) {
                                best = Some((d, p.region));
                            }
                        }
                    }
                }
            }
        }
        best.map(|(_, r)| r)
    }

    fn containing(&self, x: f64, y: f64) -> Option<u32> {
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

/// Tira as linhas que não caem em nenhuma região da malha (ex.: lugares de países vizinhos num recorte
/// retangular do Brasil). O litoral e as divisas usam a mesma tolerância da contagem. Devolve quantas saíram.
pub fn clip(level: &RegionLevel, t: &mut Table) -> usize {
    let keep: Vec<bool> = t.x.par_iter().zip(t.y.par_iter()).map(|(&x, &y)| level.locate(x as f64, y as f64).is_some()).collect();
    let removed = keep.iter().filter(|k| !**k).count();
    if removed > 0 {
        t.retain(&keep);
    }
    removed
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
        // Pouco fora do contorno (litoral simplificado): entra na região mais próxima.
        assert_eq!(at(-47.01, -23.5).as_deref(), Some("A"));
    }

    #[test]
    fn recorte_tira_o_que_esta_fora_da_malha_com_todas_as_colunas() {
        use crate::table::{ColorInput, ColumnData, InputColumn, table_from_points};
        let json = r#"{"type":"FeatureCollection","features":[
          {"type":"Feature","properties":{"codigo":"A"},"geometry":{"type":"Polygon","coordinates":[[[-47,-24],[-46,-24],[-46,-23],[-47,-23],[-47,-24]]]}}
        ]}"#;
        let level = RegionLevel::from_geojson("t", json, "codigo").expect("malha");
        // Dentro, longe (fora), no litoral (tolerância) e longe de novo.
        let lat = [-23.5, -10.0, -23.5, -30.0];
        let lon = [-46.5, -40.0, -47.01, -60.0];
        let names = ["dentro", "longe", "litoral", "vizinho"].map(String::from).to_vec();
        let mut t = table_from_points(&lat, &lon, ColorInput::None, vec![InputColumn::Text("nome".into(), names)], crate::pipeline::FINEST_RESOLUTION).expect("tabela");
        assert_eq!(clip(&level, &mut t), 2);
        assert_eq!(t.len(), 2);
        assert_eq!(t.cells.len(), 2);
        let ColumnData::Text(kept) = &t.columns[0].data else { panic!("coluna de texto") };
        assert_eq!(kept, &["dentro", "litoral"]);
        assert!(t.bounds[0] < -47.0 && t.bounds[2] > -46.6 && t.bounds[1] > -23.6, "retângulo refeito: {:?}", t.bounds);
    }
}
