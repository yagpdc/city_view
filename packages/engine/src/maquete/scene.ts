/**
 * Maquete: a área recortada num disco, prédios com arestas marcadas, seus dados como alfinetes e as vistas
 * técnicas (planta e fachadas) ao lado da vista principal. Cores do mapa base (tema claro/escuro), com o
 * mapa visível atrás (fundo transparente).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { localToLngLat, type MaqueteData, type XY } from "./extract";

export interface MaqueteView {
  id: "plan" | "south" | "east";
  label: string;
}

/** Vistas técnicas desenhadas nos cantos (mesma cena, câmeras ortográficas). */
export const MAQUETE_VIEWS: MaqueteView[] = [
  { id: "plan", label: "Planta" },
  { id: "south", label: "Fachada sul" },
  { id: "east", label: "Fachada leste" },
];

/** Cores da maquete, tiradas do mapa base (`CityMap.maquetePalette`). */
export interface MaquetePalette {
  ground: string;
  grid: string;
  park: string;
  water: string;
  road: string;
  roadCasing: string;
  path: string;
  building: string;
  buildingEdge: string;
  footprint: string;
  slabSide: string;
  slabBottom: string;
  ring: string;
  /** Ponto escolhido (cor de ação do app). */
  accent: string;
  /** Fundo das vistas técnicas. */
  viewBackground: string;
  dark: boolean;
}

const SLAB_DEPTH = 18;

/** O que foi clicado na maquete: um prédio ou um dos seus pontos na rua (índices em `MaqueteData`). */
export type MaqueteSelection = { kind: "building"; index: number } | { kind: "point"; index: number } | null;

/** Layout das vistas técnicas: coluna à direita (ou embaixo, em tela estreita). */
function insetRects(w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  const narrow = w < 760;
  const gap = 12;
  if (narrow) {
    // Faixa acima da barra de controles (que fica no rodapé).
    const iw = (w - gap * 4) / 3;
    const ih = Math.min(iw * 0.75, h * 0.2);
    return [0, 1, 2].map((i) => ({ x: gap + i * (iw + gap), y: 128, w: iw, h: ih }));
  }
  // Coluna à direita, abaixo do botão de fechar (72 px do topo).
  const iw = Math.min(280, w * 0.24);
  const ih = (h - 72 - gap * 3) / 3;
  return [0, 1, 2].map((i) => ({ x: w - iw - gap, y: gap + (2 - i) * (ih + gap), w: iw, h: ih }));
}

export class MaqueteScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  private pulse: THREE.Mesh | null = null;
  private palette: MaquetePalette;
  private data: MaqueteData | null = null;
  /** Faixas de vértices de cada prédio no mesh único (para saber qual foi clicado). */
  private buildingRanges: { start: number; index: number }[] = [];
  private body: THREE.Mesh | null = null;
  private pins: { mesh: THREE.InstancedMesh; head: THREE.InstancedMesh; indices: number[] } | null = null;
  private highlight: THREE.Group | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  /** Chamado quando o usuário clica num prédio, num ponto ou no vazio. */
  onSelect: ((selection: MaqueteSelection) => void) | null = null;
  /**
   * Clique (sem arrastar) num lugar do disco: [lon, lat] do ponto e a posição 3D dele (para ancorar um
   * cartão com `toScreen`).
   */
  onPlaceClick: ((lngLat: [number, number], anchor: [number, number, number]) => void) | null = null;
  /** A cada quadro desenhado (para elementos HTML que acompanham a cena). */
  onFrame: (() => void) | null = null;
  private markerHead: THREE.Mesh | null = null;
  private radius = 300;
  private top = 60;
  private frame = 0;
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  showViews = true;

  /** Vistas técnicas só quando há altura para elas (em tela baixa, o modelo ocupa tudo). */
  private get viewsOn(): boolean {
    return this.showViews && this.container.clientHeight >= 560;
  }

  private readonly hemi = new THREE.HemisphereLight("#ffffff", "#b9bcc4", 1.5);
  private readonly sun = new THREE.DirectionalLight("#ffffff", 1.6);

  constructor(
    private readonly container: HTMLElement,
    palette: MaquetePalette,
  ) {
    this.palette = palette;
    // Fundo transparente: o mapa (esmaecido pela tela da maquete) aparece atrás.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.root);
    this.sun.position.set(600, 900, 400);
    this.scene.add(this.hemi, this.sun);
    this.applyLights();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    // Clique (sem arrastar) seleciona prédio ou ponto.
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  /** Troca as cores (ex.: tema do app mudou); redesenhe com `setData`. */
  setPalette(palette: MaquetePalette): void {
    this.palette = palette;
    this.applyLights();
  }

  private applyLights(): void {
    const dark = this.palette.dark;
    this.hemi.color.set(dark ? "#c9d2e3" : "#ffffff");
    this.hemi.groundColor.set(dark ? "#1a1d24" : "#b9bcc4");
    this.hemi.intensity = dark ? 1.1 : 1.6;
    this.sun.intensity = dark ? 1.2 : 1.5;
  }

  set autoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }

  get autoRotate(): boolean {
    return this.controls.autoRotate;
  }

  /** Retângulos (em px, origem no canto superior esquerdo) das vistas técnicas, para os rótulos em HTML. */
  viewRects(): { id: MaqueteView["id"]; label: string; left: number; top: number; width: number; height: number }[] {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!this.viewsOn) return [];
    return insetRects(w, h).map((r, i) => ({ ...MAQUETE_VIEWS[i]!, left: r.x, top: h - r.y - r.h, width: r.w, height: r.h }));
  }

  setData(data: MaqueteData): void {
    this.clear();
    this.data = data;
    const R = data.radiusM;
    this.radius = R;
    this.top = Math.max(40, ...data.buildings.map((b) => b.height));

    this.root.add(this.slab(data));
    this.root.add(...this.buildings(data));
    if (data.points.length) this.root.add(this.pointBeams(data));
    this.root.add(this.rings(R));
    this.root.add(this.centerMarker(R));

    this.frameModel();
  }

  /** Câmera a uma distância em que o disco cabe na largura e na altura da vista. */
  private frameModel(): void {
    const R = this.radius;
    const aspect = Math.max(0.3, this.camera.aspect);
    const d = R * 2.9 * Math.max(1, 1.25 / aspect);
    this.camera.position.set(d * 0.62, d * 0.62, d * 0.78);
    this.controls.target.set(0, this.top * 0.15, 0);
    this.controls.minDistance = R * 0.6;
    this.controls.maxDistance = R * 6;
    this.controls.update();
  }

  /** Imagem PNG do que está na tela (vista principal + vistas técnicas). */
  snapshot(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointermove", this.onPointerMove);
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Construção ----------

  private clear(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    });
    this.root.clear();
    this.pulse = null;
    this.body = null;
    this.pins = null;
    this.highlight = null;
    this.buildingRanges = [];
  }

  /** Disco da área: chão desenhado (ruas, água, verde) num canvas e laterais em degradê. */
  private slab(data: MaqueteData): THREE.Group {
    const R = data.radiusM;
    const size = 2048;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = size / (2 * R);
    const px = ([x, y]: XY): XY => [size / 2 + x * s, size / 2 - y * s];
    const pal = this.palette;
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, size, size);
    // Grade de 50 m, como papel milimetrado.
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    for (let m = -R; m <= R; m += 50) {
      const [a] = px([m, 0]);
      ctx.beginPath();
      ctx.moveTo(a, 0);
      ctx.lineTo(a, size);
      ctx.stroke();
      const [, b] = px([0, m]);
      ctx.beginPath();
      ctx.moveTo(0, b);
      ctx.lineTo(size, b);
      ctx.stroke();
    }
    const fillRings = (polys: XY[][][], color: string) => {
      ctx.fillStyle = color;
      for (const rings of polys) {
        ctx.beginPath();
        for (const ring of rings) ring.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
        ctx.fill("evenodd");
      }
    };
    fillRings(data.parks, pal.park);
    fillRings(data.water, pal.water);
    const widths: Record<string, number> = { highway: 14, major_road: 10, medium_road: 7, minor_road: 5, path: 2, rail: 3 };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pass of [0, 1]) {
      for (const r of data.roads) {
        const wM = widths[r.kind] ?? 4;
        // Contorno largo e miolo, como as ruas do mapa.
        ctx.strokeStyle = pass === 0 ? pal.roadCasing : r.kind === "path" ? pal.path : pal.road;
        ctx.lineWidth = pass === 0 ? Math.max(2, wM * s * 1.15) : Math.max(1.2, wM * s * 0.85);
        ctx.beginPath();
        r.line.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
        ctx.stroke();
      }
    }
    // Sombra dos prédios no chão (planta), para a vista de cima ler bem.
    ctx.fillStyle = pal.footprint;
    for (const b of data.buildings) {
      ctx.beginPath();
      for (const ring of b.rings) ring.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
      ctx.fill("evenodd");
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 160), new THREE.MeshBasicMaterial({ map: texture }));
    top.rotation.x = -Math.PI / 2;
    group.add(top);
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.985, SLAB_DEPTH, 160, 1, true),
      new THREE.MeshStandardMaterial({ color: pal.slabSide, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    );
    side.position.y = -SLAB_DEPTH / 2;
    group.add(side);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R * 0.985, 160), new THREE.MeshBasicMaterial({ color: pal.slabBottom }));
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -SLAB_DEPTH;
    group.add(bottom);
    return group;
  }

  /** Prédios: um só mesh translúcido (cor por vértice) + arestas acesas. */
  private buildings(data: MaqueteData): THREE.Object3D[] {
    const geoms: THREE.BufferGeometry[] = [];
    const edges: THREE.BufferGeometry[] = [];
    const neutral = new THREE.Color(this.palette.building);
    let vertex = 0;
    for (const [index, b] of data.buildings.entries()) {
      const [outer, ...holes] = b.rings;
      if (!outer || outer.length < 4) continue;
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of holes) if (h.length >= 4) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      const depth = Math.max(1, b.height - b.base);
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      // Extrusão sai no eixo Z: deita no chão (Y para cima, norte = -Z).
      g.rotateX(-Math.PI / 2);
      g.translate(0, b.base, 0);
      const color = b.color ? new THREE.Color(b.color) : neutral;
      const n = g.getAttribute("position").count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      // Sem uv/normal diferentes entre partes: o merge exige os mesmos atributos.
      g.deleteAttribute("uv");
      this.buildingRanges.push({ start: vertex, index });
      vertex += n;
      geoms.push(g);
      edges.push(new THREE.EdgesGeometry(g, 30));
    }
    if (geoms.length === 0) return [];
    const body = new THREE.Mesh(
      mergeGeometries(geoms),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    );
    const lines = new THREE.LineSegments(
      mergeGeometries(edges),
      new THREE.LineBasicMaterial({ color: this.palette.buildingEdge, transparent: true, opacity: 0.7 }),
    );
    for (const g of [...geoms, ...edges]) g.dispose();
    this.body = body;
    return [body, lines];
  }

  /**
   * Seus dados na rua: alfinetes da cor da categoria. Os que caem num prédio não viram alfinete — o prédio
   * já está pintado com eles (e o clique no prédio mostra os registros).
   */
  private pointBeams(data: MaqueteData): THREE.Object3D {
    const group = new THREE.Group();
    const indices = data.points.flatMap((p, i) => (p.building === -1 ? [i] : []));
    if (indices.length === 0) return group;
    const dense = indices.length > 600;
    const beamH = dense ? Math.max(10, this.top * 0.1) : Math.max(24, this.top * 0.25);
    const beam = new THREE.CylinderGeometry(dense ? 0.5 : 0.9, dense ? 0.5 : 0.9, beamH, 6, 1, true);
    beam.translate(0, beamH / 2, 0);
    const mesh = new THREE.InstancedMesh(beam, new THREE.MeshBasicMaterial(), indices.length);
    const dot = new THREE.InstancedMesh(new THREE.SphereGeometry(dense ? 1.8 : 3, 10, 6), new THREE.MeshBasicMaterial(), indices.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    indices.forEach((pi, i) => {
      const p = data.points[pi]!;
      m.makeTranslation(p.x, p.ground + 0.5, -p.y);
      mesh.setMatrixAt(i, m);
      m.makeTranslation(p.x, p.ground + beamH, -p.y);
      dot.setMatrixAt(i, m);
      c.set(p.color);
      mesh.setColorAt(i, c);
      dot.setColorAt(i, c);
    });
    this.pins = { mesh, head: dot, indices };
    group.add(mesh, dot);
    return group;
  }

  // ---------- Seleção ----------

  /** Destaca um prédio ou ponto (contorno e véu na cor de ação); null limpa. */
  select(selection: MaqueteSelection): void {
    if (this.highlight) {
      this.highlight.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
      this.root.remove(this.highlight);
      this.highlight = null;
    }
    const data = this.data;
    if (!selection || !data) return;
    const accent = this.palette.accent;
    const group = new THREE.Group();
    if (selection.kind === "building") {
      const b = data.buildings[selection.index];
      if (!b) return;
      const [outer, ...holes] = b.rings;
      const shape = new THREE.Shape(outer!.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of holes) if (h.length >= 4) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1, b.height - b.base) + 0.6, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, b.base, 0);
      group.add(
        new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.28, depthWrite: false })),
        new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: accent })),
      );
    } else {
      const p = data.points[selection.index];
      if (!p) return;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(4, 6.5, 32),
        new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, p.ground + 0.7, -p.y);
      group.add(ring);
    }
    this.highlight = group;
    this.root.add(group);
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (this.down || !this.data) return;
    this.renderer.domElement.style.cursor = this.pick(e) ? "pointer" : "";
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const down = this.down;
    this.down = null;
    // Arrastou (girou a câmera): não é clique.
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const selection = this.pick(e);
    this.select(selection);
    this.onSelect?.(selection);
    const place = this.placeAt(e);
    if (place) this.onPlaceClick?.(place.lngLat, place.anchor);
  };

  /** Ponto do disco sob o cursor (telhado de prédio ou chão), em [lon, lat] e em 3D. */
  private placeAt(e: PointerEvent): { lngLat: [number, number]; anchor: [number, number, number] } | null {
    if (!this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const r of this.viewRects()) if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), this.camera);
    let point: THREE.Vector3 | null = this.body ? (this.raycaster.intersectObject(this.body, false)[0]?.point ?? null) : null;
    if (!point) {
      const ground = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ground)) return null;
      if (Math.hypot(ground.x, ground.z) > this.radius) return null;
      point = ground;
    }
    const [lon, lat] = localToLngLat(this.data.center, [point.x, -point.z]);
    return { lngLat: [lon, lat], anchor: [point.x, point.y, point.z] };
  }

  /** Ponto do topo da haste do ponto escolhido (para ancorar o cartão da foto). */
  centerAnchor(): [number, number, number] {
    return [0, this.top * 1.25 + this.radius * 0.025, 0];
  }

  /** Esconde o losango do topo da haste (quando um cartão ocupa o lugar dele). */
  set markerHeadVisible(on: boolean) {
    if (this.markerHead) this.markerHead.visible = on;
  }

  /** Posição na tela (px, relativo à maquete) de um ponto 3D; null se estiver atrás da câmera. */
  toScreen([x, y, z]: [number, number, number]): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const { clientWidth: w, clientHeight: h } = this.container;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /** O que está sob o cursor na vista principal (as vistas técnicas não respondem a clique). */
  private pick(e: PointerEvent): MaqueteSelection {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const r of this.viewRects()) if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), this.camera);
    const targets: THREE.Object3D[] = [];
    if (this.pins) targets.push(this.pins.head, this.pins.mesh);
    if (this.body) targets.push(this.body);
    const [hit] = this.raycaster.intersectObjects(targets, false);
    if (!hit) return null;
    if (this.pins && (hit.object === this.pins.head || hit.object === this.pins.mesh) && hit.instanceId !== undefined) {
      return { kind: "point", index: this.pins.indices[hit.instanceId]! };
    }
    if (hit.object === this.body && hit.faceIndex !== undefined && hit.faceIndex !== null) {
      const v = hit.faceIndex * 3;
      // Busca binária na faixa de vértices.
      let lo = 0;
      let hi = this.buildingRanges.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.buildingRanges[mid]!.start <= v) lo = mid;
        else hi = mid - 1;
      }
      const r = this.buildingRanges[lo];
      return r ? { kind: "building", index: r.index } : null;
    }
    return null;
  }

  /** Anel na borda, anel externo com marcas a cada 10° e o norte. */
  private rings(R: number): THREE.Object3D {
    const ringColor = this.palette.ring;
    const group = new THREE.Group();
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.997, R * 1.004, 200),
      new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.4;
    group.add(edge);
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.12, R * 1.125, 200),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -SLAB_DEPTH;
    group.add(outer);
    const ticks: number[] = [];
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180;
      const len = deg % 90 === 0 ? 0.07 : 0.03;
      ticks.push(Math.sin(a) * R * 1.125, -SLAB_DEPTH, -Math.cos(a) * R * 1.125, Math.sin(a) * R * (1.125 + len), -SLAB_DEPTH, -Math.cos(a) * R * (1.125 + len));
    }
    const tickGeom = new THREE.BufferGeometry();
    tickGeom.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    group.add(new THREE.LineSegments(tickGeom, new THREE.LineBasicMaterial({ color: ringColor })));
    // Seta do norte.
    const arrow = new THREE.Shape([new THREE.Vector2(0, R * 0.09), new THREE.Vector2(-R * 0.025, 0), new THREE.Vector2(R * 0.025, 0)]);
    const north = new THREE.Mesh(new THREE.ShapeGeometry(arrow), new THREE.MeshBasicMaterial({ color: this.palette.accent, side: THREE.DoubleSide }));
    north.rotation.x = -Math.PI / 2;
    north.position.set(0, -SLAB_DEPTH + 0.5, -R * 1.2);
    group.add(north);
    return group;
  }

  /** O ponto escolhido: haste na cor de ação acima de tudo e um anel que pulsa no chão. */
  private centerMarker(R: number): THREE.Object3D {
    const group = new THREE.Group();
    const h = this.top * 1.25;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, h, 10, 1, true).translate(0, h / 2, 0),
      new THREE.MeshBasicMaterial({ color: this.palette.accent }),
    );
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.022), new THREE.MeshBasicMaterial({ color: this.palette.accent }));
    head.position.y = h + R * 0.025;
    this.markerHead = head;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.04, R * 0.05, 64),
      new THREE.MeshBasicMaterial({ color: this.palette.accent, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.6;
    this.pulse = ring;
    group.add(beam, head, ring);
    return group;
  }

  // ---------- Desenho ----------

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    if (this.pulse) {
      const k = (t * 0.6) % 1;
      this.pulse.scale.setScalar(1 + k * 3);
      (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }
    this.controls.update();
    this.render();
    this.onFrame?.();
  };

  private render(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    // Com as vistas técnicas à direita, o modelo centraliza no espaço que sobra.
    // Em tela estreita, as vistas ficam embaixo e os números em cima: centraliza no meio livre.
    let dx = 0;
    let dy = 0;
    if (this.viewsOn && w >= 760) dx = (Math.min(280, w * 0.24) + 12) / 2;
    else if (this.viewsOn) {
      const ih = Math.min(((w - 48) / 3) * 0.75, h * 0.2);
      const freeTop = h * 0.3;
      const freeBottom = h - 128 - ih;
      dy = h / 2 - (freeTop + freeBottom) / 2;
    }
    if (dx || dy) this.camera.setViewOffset(w, h, dx, dy, w, h);
    else this.camera.clearViewOffset();
    r.render(this.scene, this.camera);
    if (!this.viewsOn) return;

    // Vistas técnicas: ortográficas, sem rotação.
    const R = this.radius * 1.08;
    r.setScissorTest(true);
    for (const [i, rect] of insetRects(w, h).entries()) {
      const view = MAQUETE_VIEWS[i]!;
      const aspect = rect.w / rect.h;
      const cam = this.ortho;
      if (view.id === "plan") {
        const half = Math.max(R, R / aspect);
        cam.left = -half * aspect;
        cam.right = half * aspect;
        cam.top = half;
        cam.bottom = -half;
        cam.position.set(0, 5000, 0);
        cam.up.set(0, 0, -1);
        cam.lookAt(0, 0, 0);
      } else {
        const hh = Math.max((this.top + SLAB_DEPTH) * 0.62, R / aspect / 2);
        cam.left = -R;
        cam.right = R;
        cam.top = hh + this.top * 0.35;
        cam.bottom = -hh + this.top * 0.35 - SLAB_DEPTH;
        cam.up.set(0, 1, 0);
        if (view.id === "south") cam.position.set(0, this.top * 0.3, 5000);
        else cam.position.set(5000, this.top * 0.3, 0);
        cam.lookAt(0, this.top * 0.3, 0);
      }
      cam.updateProjectionMatrix();
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.setClearColor(this.palette.viewBackground, 1);
      r.clear();
      r.render(this.scene, cam);
    }
    r.setClearColor(0x000000, 0);
    r.setScissorTest(false);
  }
}
