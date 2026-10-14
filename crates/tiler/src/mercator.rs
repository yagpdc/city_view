//! Projeção Web Mercator em coordenadas inteiras de "mundo" (0..2^32 em cada eixo).
//!
//! Trabalhar em inteiros de 32 bits deixa o endereçamento de tiles exato e barato:
//! o tile de um ponto no zoom z é só `x >> (32 - z)`.

use std::f64::consts::PI;

pub const MAX_LAT: f64 = 85.051_128_779_806_59;
const WORLD: f64 = 4_294_967_296.0; // 2^32

/// Bits de resolução dentro de um tile (extent MVT = 4096).
pub const EXTENT_BITS: u32 = 12;
pub const EXTENT: u32 = 1 << EXTENT_BITS;

/// Projeta lon/lat (graus) para coordenadas de mundo em f64, sem limitar ao intervalo.
pub fn project_f64(lon: f64, lat: f64) -> (f64, f64) {
    let x = (lon + 180.0) / 360.0 * WORLD;
    let s = lat.clamp(-MAX_LAT, MAX_LAT).to_radians().sin();
    let y = (0.5 - ((1.0 + s) / (1.0 - s)).ln() / (4.0 * PI)) * WORLD;
    (x, y)
}

/// Projeta um ponto válido. Retorna `None` para coordenadas fora do domínio do Web Mercator.
pub fn project(lon: f64, lat: f64) -> Option<(u32, u32)> {
    if !lon.is_finite() || !lat.is_finite() || !(-180.0..180.0).contains(&lon) || lat.abs() > MAX_LAT {
        return None;
    }
    let (x, y) = project_f64(lon, lat);
    Some((x.clamp(0.0, WORLD - 1.0) as u32, y.clamp(0.0, WORLD - 1.0) as u32))
}

/// Volta das coordenadas de mundo para lon/lat (graus).
pub fn unproject(x: u32, y: u32) -> (f64, f64) {
    let lon = x as f64 / WORLD * 360.0 - 180.0;
    let n = PI * (1.0 - 2.0 * y as f64 / WORLD);
    (lon, n.sinh().atan().to_degrees())
}

/// Índice do tile que contém a coordenada de mundo `v` no zoom `z`.
pub fn tile_index(v: i64, z: u8) -> i64 {
    v >> (32 - z as u32)
}

/// Converte coordenada de mundo para coordenada local do tile (0..EXTENT dentro do tile).
/// Pode sair do intervalo para geometrias que cruzam a borda. Requer z <= 20.
pub fn to_local(v: i64, tile: i64, z: u8) -> i32 {
    let z = z as u32;
    let origin = tile << (32 - z);
    ((v - origin) >> (32 - z - EXTENT_BITS)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_and_center() {
        assert_eq!(project(-180.0, 0.0), Some((0, 1 << 31)));
        assert_eq!(project(0.0, 0.0), Some((1 << 31, 1 << 31)));
        assert_eq!(project(180.0, 0.0), None);
        assert_eq!(project(0.0, 89.0), None);
    }

    #[test]
    fn sao_paulo_tile_z14() {
        // Praça da Sé: fórmula padrão de tiles (slippy map) dá 14/6069/9295.
        let (x, y) = project(-46.6339, -23.5503).unwrap();
        assert_eq!(tile_index(x as i64, 14), 6069);
        assert_eq!(tile_index(y as i64, 14), 9295);
    }

    #[test]
    fn local_coordinates() {
        let z = 10;
        let tile = 5i64;
        let origin = tile << 22;
        assert_eq!(to_local(origin, tile, z), 0);
        assert_eq!(to_local(origin + (1 << 22) - 1, tile, z), 4095);
        assert_eq!(to_local(origin - (1 << 10), tile, z), -1);
    }
}
