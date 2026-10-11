import type { DatapackField, MapPick } from "@cityview/engine";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

// Rótulos do dataset de demonstração (o cliente forneceria isso no mapeamento de colunas).
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

function formatField(field: DatapackField, value: unknown): string {
  if (value === undefined || value === null) return "–";
  if (field.format === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const text =
    typeof value === "number" ? (field.format === "int" ? int.format(value) : dec.format(value)) : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

export function PickDetails({ pick }: { pick: MapPick | null }) {
  if (!pick) return <p className="muted">Clique no mapa para ver o que há naquele ponto.</p>;
  const empty = !pick.dataset && pick.catalog.length === 0;
  return (
    <div className="pick">
      <p className="muted coords">
        {pick.lngLat[1].toFixed(5)}, {pick.lngLat[0].toFixed(5)}
      </p>
      {empty && <p className="muted">Nenhuma camada ligada tem dados aqui.</p>}

      {pick.dataset?.kind === "record" && (
        <div className="pick-card">
          <h4>Seus dados · Empresa #{pick.dataset.id}</h4>
          <p>
            {SECTORS[pick.dataset.sector]} · {SIZES[pick.dataset.size]} · aberta em {pick.dataset.year}
          </p>
        </div>
      )}
      {pick.dataset?.kind === "aggregate" && (
        <div className="pick-card">
          <h4>Seus dados · {int.format(pick.dataset.count)} empresas</h4>
          <p>
            {int.format(pick.dataset.count / pick.dataset.areaKm2)} por km² nesta área de{" "}
            {int.format(pick.dataset.areaKm2)} km²
          </p>
        </div>
      )}

      {pick.catalog.map(({ datapack, properties }, i) => (
        <div key={`${datapack.id}-${i}`} className="pick-card">
          <h4>{datapack.name}</h4>
          <dl>
            {datapack.fields.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{formatField(f, properties[f.key])}</dd>
              </div>
            ))}
          </dl>
          <p className="muted source">Fonte: {datapack.attribution || datapack.source.name}</p>
        </div>
      ))}
    </div>
  );
}
