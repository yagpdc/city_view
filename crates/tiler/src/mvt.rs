//! Codificador mínimo de Mapbox Vector Tiles (spec 2.1), sem dependências.
//!
//! Suporta o que o pipeline precisa: pontos e polígonos simples (um anel),
//! propriedades uint/float com deduplicação de chaves e valores por layer.

use std::collections::HashMap;

use crate::mercator::EXTENT;

const WIRE_VARINT: u32 = 0;
const WIRE_LEN: u32 = 2;
const WIRE_FIXED32: u32 = 5;

const GEOM_POINT: u32 = 1;
const GEOM_POLYGON: u32 = 3;

const CMD_MOVE_TO: u32 = 1;
const CMD_LINE_TO: u32 = 2;
const CMD_CLOSE_PATH: u32 = 7;

#[derive(Clone, Copy, Debug)]
pub enum Value {
    UInt(u64),
    Float(f32),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum ValueKey {
    UInt(u64),
    Float(u32),
}

impl From<Value> for ValueKey {
    fn from(v: Value) -> Self {
        match v {
            Value::UInt(u) => ValueKey::UInt(u),
            Value::Float(f) => ValueKey::Float(f.to_bits()),
        }
    }
}

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn write_tag(out: &mut Vec<u8>, field: u32, wire: u32) {
    write_varint(out, ((field << 3) | wire) as u64);
}

fn write_bytes(out: &mut Vec<u8>, field: u32, bytes: &[u8]) {
    write_tag(out, field, WIRE_LEN);
    write_varint(out, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

fn write_packed(out: &mut Vec<u8>, field: u32, values: &[u32]) {
    let mut buf = Vec::with_capacity(values.len() * 2);
    values.iter().for_each(|&v| write_varint(&mut buf, v as u64));
    write_bytes(out, field, &buf);
}

fn zigzag(v: i32) -> u32 {
    ((v << 1) ^ (v >> 31)) as u32
}

fn command(id: u32, count: u32) -> u32 {
    (id & 0x7) | (count << 3)
}

pub struct LayerBuilder {
    name: &'static str,
    keys: Vec<&'static str>,
    key_index: HashMap<&'static str, u32>,
    values: Vec<Value>,
    value_index: HashMap<ValueKey, u32>,
    features: Vec<u8>,
    feature_count: usize,
    tags: Vec<u32>,
    geometry: Vec<u32>,
}

impl LayerBuilder {
    pub fn new(name: &'static str) -> Self {
        Self {
            name,
            keys: Vec::new(),
            key_index: HashMap::new(),
            values: Vec::new(),
            value_index: HashMap::new(),
            features: Vec::new(),
            feature_count: 0,
            tags: Vec::new(),
            geometry: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.feature_count
    }

    pub fn is_empty(&self) -> bool {
        self.feature_count == 0
    }

    pub fn add_point(&mut self, id: Option<u64>, x: i32, y: i32, props: &[(&'static str, Value)]) {
        self.geometry.clear();
        self.geometry.extend([command(CMD_MOVE_TO, 1), zigzag(x), zigzag(y)]);
        self.push_feature(id, GEOM_POINT, props);
    }

    /// Adiciona um polígono de um anel (sem repetir o primeiro vértice no fim).
    /// Remove vértices repetidos após a quantização e corrige a orientação.
    /// Retorna `false` se o polígono degenerou (menos de 3 vértices ou área zero).
    pub fn add_polygon(&mut self, id: Option<u64>, ring: &mut Vec<(i32, i32)>, props: &[(&'static str, Value)]) -> bool {
        ring.dedup();
        while ring.len() > 1 && ring.first() == ring.last() {
            ring.pop();
        }
        if ring.len() < 3 {
            return false;
        }
        // MVT: anel externo com área positiva (horário na tela, y para baixo).
        let area2: i64 = (0..ring.len())
            .map(|i| {
                let (x0, y0) = ring[i];
                let (x1, y1) = ring[(i + 1) % ring.len()];
                x0 as i64 * y1 as i64 - x1 as i64 * y0 as i64
            })
            .sum();
        if area2 == 0 {
            return false;
        }
        if area2 < 0 {
            ring.reverse();
        }

        self.geometry.clear();
        let (mut cx, mut cy) = ring[0];
        self.geometry.extend([command(CMD_MOVE_TO, 1), zigzag(cx), zigzag(cy)]);
        self.geometry.push(command(CMD_LINE_TO, ring.len() as u32 - 1));
        for &(x, y) in &ring[1..] {
            self.geometry.extend([zigzag(x - cx), zigzag(y - cy)]);
            (cx, cy) = (x, y);
        }
        self.geometry.push(command(CMD_CLOSE_PATH, 1));
        self.push_feature(id, GEOM_POLYGON, props);
        true
    }

    fn push_feature(&mut self, id: Option<u64>, geom_type: u32, props: &[(&'static str, Value)]) {
        self.tags.clear();
        for &(key, value) in props {
            let k = *self.key_index.entry(key).or_insert_with(|| {
                self.keys.push(key);
                self.keys.len() as u32 - 1
            });
            let v = *self.value_index.entry(value.into()).or_insert_with(|| {
                self.values.push(value);
                self.values.len() as u32 - 1
            });
            self.tags.extend([k, v]);
        }

        let mut feature = Vec::with_capacity(16 + self.geometry.len() * 2);
        if let Some(id) = id {
            write_tag(&mut feature, 1, WIRE_VARINT);
            write_varint(&mut feature, id);
        }
        if !self.tags.is_empty() {
            write_packed(&mut feature, 2, &self.tags);
        }
        write_tag(&mut feature, 3, WIRE_VARINT);
        write_varint(&mut feature, geom_type as u64);
        write_packed(&mut feature, 4, &self.geometry);

        write_bytes(&mut self.features, 2, &feature);
        self.feature_count += 1;
    }

    /// Serializa o layer como campo `layers` de um Tile, anexando em `tile`.
    pub fn write_to(&self, tile: &mut Vec<u8>) {
        let mut layer = Vec::with_capacity(self.features.len() + 256);
        write_tag(&mut layer, 15, WIRE_VARINT);
        write_varint(&mut layer, 2);
        write_bytes(&mut layer, 1, self.name.as_bytes());
        layer.extend_from_slice(&self.features);
        for key in &self.keys {
            write_bytes(&mut layer, 3, key.as_bytes());
        }
        for value in &self.values {
            let mut v = Vec::with_capacity(10);
            match *value {
                Value::Float(f) => {
                    write_tag(&mut v, 2, WIRE_FIXED32);
                    v.extend_from_slice(&f.to_le_bytes());
                }
                Value::UInt(u) => {
                    write_tag(&mut v, 5, WIRE_VARINT);
                    write_varint(&mut v, u);
                }
            }
            write_bytes(&mut layer, 4, &v);
        }
        write_tag(&mut layer, 5, WIRE_VARINT);
        write_varint(&mut layer, EXTENT as u64);
        write_bytes(tile, 3, &layer);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_and_zigzag() {
        let mut out = Vec::new();
        write_varint(&mut out, 300);
        assert_eq!(out, [0xAC, 0x02]);
        assert_eq!(zigzag(0), 0);
        assert_eq!(zigzag(-1), 1);
        assert_eq!(zigzag(1), 2);
        assert_eq!(zigzag(-2), 3);
    }

    #[test]
    fn polygon_orientation_and_degenerates() {
        let mut layer = LayerBuilder::new("t");
        // Anti-horário na tela → deve ser invertido.
        let mut ring = vec![(0, 0), (0, 10), (10, 10), (10, 0)];
        assert!(layer.add_polygon(None, &mut ring, &[]));
        assert_eq!(ring, vec![(10, 0), (10, 10), (0, 10), (0, 0)]);
        // Colapsou num ponto após quantização.
        let mut tiny = vec![(5, 5), (5, 5), (5, 5)];
        assert!(!layer.add_polygon(None, &mut tiny, &[]));
        assert_eq!(layer.len(), 1);
    }

    #[test]
    fn point_feature_bytes() {
        let mut layer = LayerBuilder::new("p");
        layer.add_point(Some(7), 25, 17, &[("k", Value::UInt(3))]);
        let mut tile = Vec::new();
        layer.write_to(&mut tile);
        // Feature: id=7, tags=[0,0], type=1, geometry=[9, 50, 34] (exemplo da spec MVT).
        let feature = [0x08, 0x07, 0x12, 0x02, 0x00, 0x00, 0x18, 0x01, 0x22, 0x03, 0x09, 0x32, 0x22];
        assert!(tile.windows(feature.len()).any(|w| w == feature));
    }
}
