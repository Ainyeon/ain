// 도면 내보내기·불러오기 — 문서 JSON(저장·내려받기)과 엔진 공간 JSON(data.space) 변환 (순수 로직, DOM 없음)
import { AC_PANEL_MM, AC_BODY_MM, curFloor, fixSeq, validateDoc } from './model.js';
import { pointInPoly, polyCentroid, projectOnSeg, roomAreaM2 } from './geom.js';

export const toDocJSON = (doc) => JSON.stringify(doc);

export function fromDocJSON(str) { // 깨진 입력이면 Error('도면 파일을 읽지 못했습니다') — err.problems 에 자세한 문제 목록
  const fail = (problems) => { const e = new Error('도면 파일을 읽지 못했습니다'); e.problems = problems; throw e; };
  let doc;
  try { doc = JSON.parse(str); } catch { return fail(['JSON 형식이 아닙니다']); }
  const bad = validateDoc(doc);
  if (bad.length) fail(bad);
  return fixSeq({ ...doc, underlay: doc.underlay ?? null });
}

const CAPACITY_KW = [1.2, 1.6, 2.0, 2.3, 3.2, 4.0, 5.2, 6.0, 7.2]; // 엔진 예시(apartment.json)와 같은 값
const M2_PER_PYEONG = 3.3058;
// 엔진 검사기 규칙 상수 — 엔진 예시(apartment.json)와 같은 값(출처 문구는 비움)
const AC_RULES = { wall_edge_min_mm: 1500, wall_center_min_mm_4way950: 2000, oneway_discharge_clear_mm: 1500, oneway_side_clear_mm: 150, light_gap_min_mm: 600, grid_tol_mm: 1, division_tol_mm: 1, floor_to_bottom_min_mm: 2200, manual_min_install_height_mm: 2500, body_top_clear_mm: 150, unit_spacing_mm: [5000, 8000], throw_radius_mm: 5000, bar_gap_min_mm: 600, heat_source_min_mm: 1000, meeting_models: ['1way', 'mini_4way'], basis: '' };

// 한 층을 엔진 공간 JSON 의 data.space 로. 좌표·치수는 정수 mm, 넓이는 소수 둘째 자리.
// 곡선벽은 엔진이 직선만 다루므로 현(a→b)으로 내보낸다. 평면에 없는 값(조명·배관·실외기 등)은 비워 둔다.
export function toSpaceJSON(doc, floorIndex = doc.cur, { spaceType = 'apartment' } = {}) {
  const f = doc.floors[floorIndex];
  if (!f) throw new Error('층을 찾을 수 없습니다');
  const R = Math.round, R2 = (v) => Math.round(v * 100) / 100, pt = (p) => [R(p[0]), R(p[1])], H = f.heightMm;
  const roomAt = (p) => f.rooms.find((r) => pointInPoly(r.poly, p))?.id ?? '';
  const rooms = f.rooms.map((r) => ({ id: r.id, name_ko: r.name, polygon: r.poly.map(pt), area_m2: R2(roomAreaM2(doc, r)), ceiling_mm: H, floor_finish: f.finish.floor, finished_ceiling: true, basis: '' }));
  const total = R2(rooms.reduce((s, r) => s + r.area_m2, 0));
  const xs = f.rooms.flatMap((r) => r.poly.map((p) => p[0])), ys = f.rooms.flatMap((r) => r.poly.map((p) => p[1]));
  const wallFaceDist = (c) => { // 중심에서 가장 가까운 벽 면까지, 그 벽 법선 방향 반 크기(제품 모서리까지)
    let best = null;
    for (const w of f.walls) { const d = projectOnSeg(c, w.a, w.b).d - w.t / 2; if (!best || d < best.d) best = { d, w }; }
    return best;
  };
  const acUnits = f.items.map((i) => {
    const room = roomAt(i.c), near = wallFaceDist(i.c), t = (i.rot * Math.PI) / 180;
    let edge = null;
    if (near) {
      const e = [near.w.b[0] - near.w.a[0], near.w.b[1] - near.w.a[1]], L = Math.hypot(...e) || 1, n = [-e[1] / L, e[0] / L];
      edge = near.d - (Math.abs(n[0] * Math.cos(t) + n[1] * Math.sin(t)) * i.size[0]) / 2 - (Math.abs(-n[0] * Math.sin(t) + n[1] * Math.cos(t)) * i.size[1]) / 2;
    }
    return {
      id: i.id, zone: room ? 'Z_' + room : '', room, model: i.model === 'mini4way' ? 'mini_4way' : i.model, size_mm: [R(i.size[0]), R(i.size[1]), AC_PANEL_MM], ceiling_opening_mm: [R(i.size[0]), R(i.size[1])],
      body_h_mm: AC_BODY_MM, capacity_kw: i.capacityKw, model_code: i.code, center: pt(i.c), rotation_deg: R(((i.rot % 360) + 360) % 360), mount_z_mm: H, locked: null, basis: '',
      rule_check: { wall_center_min_mm: near ? R(Math.max(0, near.d)) : null, wall_edge_min_mm: near ? R(edge) : null, light_edge_gap_min_mm: null, grid_err_mm: [], grid_align: '' }, // 단순 거리(엔진 검사기 값 아님)
    };
  });
  return {
    space_type: spaceType, input_kind: 'plan_editor', title: doc.title, coordinate_note: '', sources: [],
    rooms, ac_units: acUnits, capacity_options_kw: [...CAPACITY_KW],
    zones: f.rooms.map((r, k) => ({ id: 'Z_' + r.id, room: r.id, kind: 'room', name_ko: r.name, polygon: rooms[k].polygon, area_m2: rooms[k].area_m2, load_area_from: ['Z_' + r.id], load_multiplier: [], research_count: [], load_basis: '', research_row: '' })),
    walls: f.walls.map((w) => ({ id: w.id, a: pt(w.a), b: pt(w.b), thickness: R(w.t), exterior: w.kind === 'exterior', kind: w.kind === 'exterior' ? 'exterior' : 'interior', basis: '' })),
    openings: f.openings.map((o) => {
      const w = f.walls.find((x) => x.id === o.wall);
      return { id: o.id, wall: o.wall, at: pt([w.a[0] + (w.b[0] - w.a[0]) * o.at, w.a[1] + (w.b[1] - w.a[1]) * o.at]), width: R(o.width), sill: R(o.sill), room: f.rooms.find((r) => r.wallIds.includes(o.wall))?.id ?? '', height: R(o.height), type: o.type, basis: '' };
    }),
    ceiling: { height_mm: H, void_mm: 300, grid: { module_x_mm: 600, module_y_mm: 600, origins: {} }, lights: [], basis: '' },
    outdoor_unit: { display_only: true, location_ko: '', sets: [], position: null, size_mm: null, rotation_deg: 0, model_code: '', room: null, basis: '', piping_type: '' },
    piping: [], piping_branches: [], ac_rules: { ...AC_RULES, unit_spacing_mm: [...AC_RULES.unit_spacing_mm], meeting_models: [...AC_RULES.meeting_models] },
    load_rule: { m2_per_pyeong: M2_PER_PYEONG, basis: '' },
    envelope: { interior_rect: xs.length ? [R(Math.min(...xs)), R(Math.min(...ys)), R(Math.max(...xs)), R(Math.max(...ys))] : [0, 0, 0, 0], area_m2: total, target_pyeong: R2(total / M2_PER_PYEONG), tolerance_pyeong: 0.5, area_basis: '', all_rooms_m2: total },
    load_total: { multiplier: 1.3, research_count_4way: 0, research_row: '', basis: '' },
    views: [], labels: f.rooms.map((r) => ({ text: r.name, at: pt(polyCentroid(r.poly)) })), assumptions: [], decisions_pending: [],
  };
}
