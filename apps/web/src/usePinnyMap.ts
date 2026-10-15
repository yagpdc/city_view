import { PinnyMap, type PinnyMapOptions } from "@pinny/engine";
import { useEffect, useRef, useState } from "react";

/** Cria o PinnyMap uma vez por container e destrói ao desmontar. */
export function usePinnyMap(options: Omit<PinnyMapOptions, "container">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<PinnyMap | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = new PinnyMap({ ...optionsRef.current, container: containerRef.current });
    setMap(instance);
    if (import.meta.env.DEV) Object.assign(window, { pinnyMap: instance });
    return () => {
      instance.destroy();
      setMap(null);
    };
  }, []);

  return { containerRef, map };
}
