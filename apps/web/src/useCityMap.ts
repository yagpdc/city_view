import { CityMap, type CityMapOptions } from "@cityview/engine";
import { useEffect, useRef, useState } from "react";

/** Cria o CityMap uma vez por container e destrói ao desmontar. */
export function useCityMap(options: Omit<CityMapOptions, "container">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<CityMap | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = new CityMap({ ...optionsRef.current, container: containerRef.current });
    setMap(instance);
    if (import.meta.env.DEV) Object.assign(window, { cityMap: instance });
    return () => {
      instance.destroy();
      setMap(null);
    };
  }, []);

  return { containerRef, map };
}
