import CityView, { type Filter, type Item } from "@cityview/sdk";
import "./style.css";

// O cliente conhece o significado dos próprios dados; o SDK só vê índices.
const SECTORS = [
  "Comércio varejista",
  "Comércio atacadista",
  "Alimentação",
  "Serviços profissionais",
  "Construção",
  "Indústria",
  "Saúde",
  "Educação",
  "Transporte e logística",
  "Tecnologia e informação",
];
const SIZES = ["MEI", "ME", "EPP", "Demais"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = new Intl.NumberFormat("pt-BR");
const ms = (v: number) => `${fmt.format(Math.round(v))} ms`;

// ---------- O que o cliente escreve ----------
const t0 = performance.now();
const map = CityView.map({ container: "#mapa", dataset: "/data/empresas/tiles.pmtiles" });
// ---------------------------------------------
if (import.meta.env.DEV) Object.assign(window, { cityview: map });

const info = await map.ready;
$("m-ready").textContent = ms(performance.now() - t0);

// ---------- Filtros ----------
// As categorias de cor vêm do dataset (valores de "sector", mais frequentes primeiro);
// o cliente só traduz o código para o nome que ele usa.
const sectorName = (code: string) => SECTORS[Number(code)] ?? code;
const filter: Filter = { categories: info.categories.map((_, i) => i), where: {} };

function checkboxes(containerId: string, labels: string[], colors: readonly string[] | null, onChange: (checked: number[]) => void) {
  const container = $(containerId);
  labels.forEach((label, i) => {
    const el = document.createElement("label");
    el.className = "check";
    el.innerHTML = `<input type="checkbox" checked value="${i}">${
      colors ? `<i style="background:${colors[i]}"></i>` : ""
    }<span>${label}</span>`;
    container.append(el);
  });
  container.addEventListener("change", () => {
    onChange([...container.querySelectorAll<HTMLInputElement>("input:checked")].map((c) => Number(c.value)));
    void applyFilter();
  });
}

async function applyFilter() {
  const start = performance.now();
  await map.filter(filter);
  $("m-filter").textContent = ms(performance.now() - start);
}

checkboxes("sectors", info.categories.map(sectorName), info.categoryColors, (checked) => (filter.categories = checked));
checkboxes("sizes", SIZES, null, (checked) => {
  filter.where!.size = { in: checked.map(String) };
});
$<HTMLInputElement>("year").addEventListener("input", (e) => {
  const year = Number((e.target as HTMLInputElement).value);
  $("year-out").textContent = String(year);
  if (year > 1970) filter.where!.opened_year = { gte: year };
  else delete filter.where!.opened_year;
  void applyFilter();
});

// ---------- Clique ----------
map.on("click", (item: Item | null) => {
  const el = $("picked");
  if (!item) {
    el.innerHTML = `<span class="muted">Nada aqui.</span>`;
    return;
  }
  if (item.kind === "record") {
    const p = item.properties;
    el.innerHTML = `<b>Empresa #${item.id}</b><br>${sectorName(String(p.sector))}<br>${
      SIZES[Number(p.size)] ?? p.size
    } · aberta em ${p.opened_year}`;
    return;
  }
  const visible = new Set(filter.categories);
  const top = item.byCategory
    .map((n, i) => ({ n, i }))
    .filter(({ i }) => visible.has(i))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(({ n, i }) => `${sectorName(info.categories[i] ?? "")}: ${fmt.format(n)}`)
    .join("<br>");
  el.innerHTML = `<b>${fmt.format(item.count)} empresas</b> em ${fmt.format(Math.round(item.areaKm2))} km²<br>${fmt.format(
    Math.round(item.count / item.areaKm2),
  )} por km²<br><br>${top}`;
});

// ---------- FPS (janela móvel de 1 s) ----------
const frames: number[] = [];
function sampleFps(now: number) {
  frames.push(now);
  while (frames.length && frames[0]! < now - 1000) frames.shift();
  $("m-fps").textContent = String(frames.length);
  requestAnimationFrame(sampleFps);
}
requestAnimationFrame(sampleFps);

// ---------- Benchmark: tour de câmera medindo tempo de frame ----------
const TOUR: { center: [number, number]; zoom: number }[] = [
  { center: [-46.63, -23.55], zoom: 8 },
  { center: [-46.65, -23.56], zoom: 12 },
  { center: [-46.655, -23.561], zoom: 15.5 },
  { center: [-43.19, -22.91], zoom: 11 },
  { center: [-43.18, -22.905], zoom: 15 },
  { center: [-52, -14.5], zoom: 4 },
];

$("tour").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("tour");
  button.disabled = true;
  const deltas: number[] = [];
  let last = performance.now();
  let running = true;
  const tick = (now: number) => {
    deltas.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const start = performance.now();
  for (const step of TOUR) {
    map.flyTo(step);
    await new Promise<void>((resolve) => {
      const off = map.on("idle", () => {
        off();
        resolve();
      });
    });
  }
  running = false;
  const sorted = [...deltas].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const avgFps = (deltas.length / (performance.now() - start)) * 1000;
  $("m-tour").innerHTML = `Tour: ${(performance.now() - start) / 1000 < 100 ? ((performance.now() - start) / 1000).toFixed(1) : "?"} s · média ${avgFps.toFixed(
    0,
  )} fps · p95 frame ${p95.toFixed(1)} ms · ${sorted.filter((d) => d > 50).length} travadas (&gt;50 ms)`;
  button.disabled = false;
});
