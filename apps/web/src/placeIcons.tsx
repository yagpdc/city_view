import { normalizeText } from "@pinny/engine";
import {
  BedDouble,
  BriefcaseBusiness,
  Drama,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Landmark,
  MapPin,
  ShoppingBag,
  Sparkles,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { createRoot } from "react-dom/client";

/** Ícone de cada grupo de Estabelecimentos (Overture), pelo começo do nome da categoria. */
const BY_PREFIX: [string, LucideIcon][] = [
  ["compras", ShoppingBag],
  ["servicos", BriefcaseBusiness],
  ["alimentacao", Utensils],
  ["beleza", Sparkles],
  ["viagem", BedDouble],
  ["cultura", Drama],
  ["saude", HeartPulse],
  ["educacao", GraduationCap],
  ["esporte", Dumbbell],
  ["comunidade", Landmark],
];

/** Ícone de uma categoria pelo nome (desconhecida = alfinete). */
export function placeIcon(category: string): LucideIcon {
  const name = normalizeText(category);
  return BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? MapPin;
}

/** SVG de cada ícone, para o motor rasterizar (renderiza fora da tela, uma vez). */
export async function placeIconSvgs(categories: string[]): Promise<string[]> {
  const host = document.createElement("div");
  const root = createRoot(host);
  root.render(
    <>
      {categories.map((c, i) => {
        const Icon = placeIcon(c);
        return (
          <span key={i}>
            <Icon size={24} strokeWidth={2} />
          </span>
        );
      })}
    </>,
  );
  // O React pinta no próximo ciclo; dentro de um efeito não dá para forçar (flushSync é ignorado).
  for (let tries = 0; tries < 20 && host.children.length < categories.length; tries++) await new Promise((r) => setTimeout(r, 0));
  const svgs = [...host.children].map((span) => span.innerHTML);
  root.unmount();
  return svgs;
}
