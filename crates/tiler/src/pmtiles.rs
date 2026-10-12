//! Escritor de PMTiles v3 (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
//!
//! Os tiles chegam em ordem crescente de tile id e vão direto para um arquivo temporário;
//! no fim montamos cabeçalho + diretórios + metadados e copiamos os dados. Memória constante.

use std::{
    fs::File,
    io::{self, BufWriter, Read, Write},
    path::{Path, PathBuf},
};

use flate2::{Compression, write::GzEncoder};

const HEADER_LEN: usize = 127;
const ROOT_MAX: usize = 16_384 - HEADER_LEN;
const COMPRESSION_GZIP: u8 = 2;
const TILE_TYPE_MVT: u8 = 1;

/// Tile id na curva de Hilbert, como definido pela spec do PMTiles.
pub fn tile_id(z: u8, mut x: u32, mut y: u32) -> u64 {
    let mut acc: u64 = ((1u64 << (2 * z as u64)) - 1) / 3;
    if z == 0 {
        return acc;
    }
    let mut s: u32 = 1 << (z - 1);
    while s > 0 {
        let rx = s & x;
        let ry = s & y;
        acc += ((3 * rx as u64) ^ ry as u64) * s as u64;
        if ry == 0 {
            if rx != 0 {
                x = s.wrapping_sub(1).wrapping_sub(x);
                y = s.wrapping_sub(1).wrapping_sub(y);
            }
            std::mem::swap(&mut x, &mut y);
        }
        s >>= 1;
    }
    acc
}

pub fn gzip(data: &[u8]) -> Vec<u8> {
    let mut enc = GzEncoder::new(Vec::with_capacity(data.len() / 3), Compression::default());
    enc.write_all(data).expect("gzip em memória não falha");
    enc.finish().expect("gzip em memória não falha")
}

#[derive(Clone, Copy)]
struct Entry {
    tile_id: u64,
    offset: u64,
    length: u32,
    run_length: u32,
}

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn serialize_directory(entries: &[Entry]) -> Vec<u8> {
    let mut raw = Vec::with_capacity(entries.len() * 6);
    write_varint(&mut raw, entries.len() as u64);
    let mut last_id = 0;
    for e in entries {
        write_varint(&mut raw, e.tile_id - last_id);
        last_id = e.tile_id;
    }
    entries.iter().for_each(|e| write_varint(&mut raw, e.run_length as u64));
    entries.iter().for_each(|e| write_varint(&mut raw, e.length as u64));
    for (i, e) in entries.iter().enumerate() {
        let contiguous = i > 0 && e.offset == entries[i - 1].offset + entries[i - 1].length as u64;
        write_varint(&mut raw, if contiguous { 0 } else { e.offset + 1 });
    }
    gzip(&raw)
}

/// Monta o diretório raiz e, se não couber nos primeiros 16 KB, os diretórios-folha.
fn build_directories(entries: &[Entry]) -> (Vec<u8>, Vec<u8>) {
    let root = serialize_directory(entries);
    if root.len() <= ROOT_MAX {
        return (root, Vec::new());
    }
    let mut leaf_size = 4096;
    loop {
        let mut leaves = Vec::new();
        let mut root_entries = Vec::new();
        for chunk in entries.chunks(leaf_size) {
            let leaf = serialize_directory(chunk);
            root_entries.push(Entry {
                tile_id: chunk[0].tile_id,
                offset: leaves.len() as u64,
                length: leaf.len() as u32,
                run_length: 0,
            });
            leaves.extend_from_slice(&leaf);
        }
        let root = serialize_directory(&root_entries);
        if root.len() <= ROOT_MAX {
            return (root, leaves);
        }
        leaf_size *= 2;
    }
}

pub struct HeaderInfo {
    pub min_zoom: u8,
    pub max_zoom: u8,
    /// [oeste, sul, leste, norte] em graus.
    pub bounds: [f64; 4],
    pub center_zoom: u8,
}

/// Onde os tiles ficam até o fim: arquivo temporário (servidor) ou memória (navegador/WASM).
enum Sink {
    File { path: PathBuf, buf: BufWriter<File> },
    Memory(Vec<u8>),
}

pub struct Writer {
    sink: Sink,
    entries: Vec<Entry>,
    offset: u64,
}

impl Writer {
    pub fn create(out: &Path) -> io::Result<Self> {
        let path = out.with_extension("pmtiles.tmp");
        Ok(Self {
            sink: Sink::File { buf: BufWriter::with_capacity(8 << 20, File::create(&path)?), path },
            entries: Vec::new(),
            offset: 0,
        })
    }

    /// Tudo em memória (sem sistema de arquivos), para rodar no navegador.
    pub fn in_memory() -> Self {
        Self { sink: Sink::Memory(Vec::new()), entries: Vec::new(), offset: 0 }
    }

    /// Adiciona um tile já comprimido (gzip). Os ids precisam vir em ordem crescente.
    pub fn add_tile(&mut self, tile_id: u64, data: &[u8]) -> io::Result<()> {
        if let Some(last) = self.entries.last() {
            assert!(tile_id > last.tile_id, "tiles fora de ordem: {tile_id} <= {}", last.tile_id);
        }
        match &mut self.sink {
            Sink::File { buf, .. } => buf.write_all(data)?,
            Sink::Memory(v) => v.extend_from_slice(data),
        }
        self.entries.push(Entry { tile_id, offset: self.offset, length: data.len() as u32, run_length: 1 });
        self.offset += data.len() as u64;
        Ok(())
    }

    pub fn tile_count(&self) -> usize {
        self.entries.len()
    }

    /// Cabeçalho + diretório raiz + metadados + folhas (tudo o que vem antes dos tiles).
    fn prefix(&self, info: &HeaderInfo, metadata: &serde_json::Value) -> io::Result<Vec<u8>> {
        let (root, leaves) = build_directories(&self.entries);
        let meta = gzip(serde_json::to_vec(metadata)?.as_slice());

        let root_offset = HEADER_LEN as u64;
        let meta_offset = root_offset + root.len() as u64;
        let leaves_offset = meta_offset + meta.len() as u64;
        let data_offset = leaves_offset + leaves.len() as u64;

        let e7 = |deg: f64| ((deg * 1e7).round() as i32).to_le_bytes();
        let mut h = Vec::with_capacity(HEADER_LEN + root.len() + meta.len() + leaves.len());
        h.extend_from_slice(b"PMTiles");
        h.push(3);
        for v in [
            root_offset,
            root.len() as u64,
            meta_offset,
            meta.len() as u64,
            leaves_offset,
            leaves.len() as u64,
            data_offset,
            self.offset,
            self.entries.len() as u64, // addressed tiles
            self.entries.len() as u64, // tile entries
            self.entries.len() as u64, // tile contents
        ] {
            h.extend_from_slice(&v.to_le_bytes());
        }
        h.extend([1, COMPRESSION_GZIP, COMPRESSION_GZIP, TILE_TYPE_MVT, info.min_zoom, info.max_zoom]);
        let [w, s, e, n] = info.bounds;
        for deg in [w, s, e, n] {
            h.extend_from_slice(&e7(deg));
        }
        h.push(info.center_zoom);
        h.extend_from_slice(&e7((w + e) / 2.0));
        h.extend_from_slice(&e7((s + n) / 2.0));
        debug_assert_eq!(h.len(), HEADER_LEN);
        h.extend_from_slice(&root);
        h.extend_from_slice(&meta);
        h.extend_from_slice(&leaves);
        Ok(h)
    }

    /// Grava o PMTiles em `out` (modo arquivo).
    pub fn finish(self, out: &Path, info: &HeaderInfo, metadata: &serde_json::Value) -> io::Result<()> {
        let prefix = self.prefix(info, metadata)?;
        let Sink::File { path, mut buf } = self.sink else {
            return Err(io::Error::other("writer em memória: use finish_to_vec"));
        };
        buf.flush()?;
        drop(buf);
        let mut file = BufWriter::with_capacity(8 << 20, File::create(out)?);
        file.write_all(&prefix)?;
        let mut tmp = File::open(&path)?;
        let mut chunk = vec![0u8; 8 << 20];
        loop {
            let n = tmp.read(&mut chunk)?;
            if n == 0 {
                break;
            }
            file.write_all(&chunk[..n])?;
        }
        file.flush()?;
        drop(tmp);
        std::fs::remove_file(&path)
    }

    /// Devolve o PMTiles inteiro em memória (modo `in_memory`).
    pub fn finish_to_vec(self, info: &HeaderInfo, metadata: &serde_json::Value) -> io::Result<Vec<u8>> {
        let mut out = self.prefix(info, metadata)?;
        match self.sink {
            Sink::Memory(data) => out.extend_from_slice(&data),
            Sink::File { .. } => return Err(io::Error::other("writer em arquivo: use finish")),
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hilbert_tile_ids_match_spec() {
        assert_eq!(tile_id(0, 0, 0), 0);
        assert_eq!(tile_id(1, 0, 0), 1);
        assert_eq!(tile_id(1, 0, 1), 2);
        assert_eq!(tile_id(1, 1, 1), 3);
        assert_eq!(tile_id(1, 1, 0), 4);
        assert_eq!(tile_id(2, 0, 0), 5);
        // Primeiro tile de cada zoom = (4^z - 1) / 3.
        assert_eq!(tile_id(20, 0, 0), 366_503_875_925);
    }

    #[test]
    fn ids_are_unique_and_dense_per_zoom() {
        let z = 4;
        let mut ids: Vec<u64> = (0..16).flat_map(|x| (0..16).map(move |y| tile_id(z, x, y))).collect();
        ids.sort_unstable();
        let first = tile_id(z, 0, 0);
        assert_eq!(ids, (first..first + 256).collect::<Vec<_>>());
    }
}
