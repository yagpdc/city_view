//! Cronômetro dos relatórios de tempo. No wasm32 "puro" (navegador) não há relógio no `std`
//! (`Instant::now` entra em pânico): lá os tempos saem zerados.

#[cfg(not(target_arch = "wasm32"))]
pub struct Stopwatch(std::time::Instant);

#[cfg(target_arch = "wasm32")]
pub struct Stopwatch;

impl Stopwatch {
    pub fn start() -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        return Self(std::time::Instant::now());
        #[cfg(target_arch = "wasm32")]
        return Self;
    }

    pub fn secs(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        return self.0.elapsed().as_secs_f64();
        #[cfg(target_arch = "wasm32")]
        return 0.0;
    }
}
