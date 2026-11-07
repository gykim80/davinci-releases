#!/usr/bin/env node
// OpenRouter 공개 모델 목록에서 새 모델을 찾아 model-catalog.json 에 추가한다.
// 키가 필요 없어 공개 저장소 Actions 에서 매일 돈다 (.github/workflows/model-catalog-auto.yml).
// 원본 큐레이션은 andrew-davinci 의 catalog/model-catalog.json 이고, 이 스크립트는 추가만 한다.
// 기존 항목은 건드리지 않고, 지우지도 않는다.
//
//   node scripts/discover-openrouter-models.mjs          # dry-run
//   node scripts/discover-openrouter-models.mjs --apply  # 파일 갱신 + revision 1 증가
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../model-catalog.json", import.meta.url);
const APPLY = process.argv.includes("--apply");
// 이 날짜 이후 출시분만 받는다 — 구세대까지 받으면 드롭다운이 수백 개로 분다.
const EPOCH = Date.parse(process.env.CATALOG_EPOCH || "2026-09-01") / 1000;

// 앱의 is_openrouter_model 과 같은 벤더 범위 (네이티브 CLI 모델과 겹치지 않게)
function wanted(id) {
  if (id.includes(":")) return false; // :batch 등 변형은 넣지 않는다
  const opus = id.match(/^anthropic\/claude-opus-(\d+)(?:\.(\d+))?/);
  // opus 4.x·5 는 네이티브 claude-opus-5 별칭이라 5.5 이상만
  if (opus) return +opus[1] > 5 || (+opus[1] === 5 && +(opus[2] ?? 0) >= 5);
  const gpt = id.match(/^openai\/gpt-(\d+)/);
  if (gpt) return +gpt[1] >= 6;
  return /^anthropic\/claude-(fable|sonnet|haiku)/.test(id) ||
    /^(deepseek|qwen|moonshotai|minimax|z-ai|x-ai)\//.test(id);
}

const price = (perToken) => {
  const v = Number(perToken) * 1e6;
  if (!Number.isFinite(v)) return "-";
  return `$${v >= 1 ? +v.toFixed(2) : v.toFixed(3)}/1M`;
};
const ctx = (n) => (!n ? "-" : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
const tier = (perToken) => {
  const v = Number(perToken) * 1e6;
  return v >= 4 ? "flagship" : v >= 1 ? "balanced" : "light";
};

const catalog = JSON.parse(readFileSync(FILE, "utf8"));
const known = new Set(catalog.models.flatMap((m) => [m.id, ...(m.aliases ?? [])]));

const res = await fetch("https://openrouter.ai/api/v1/models");
if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
const { data } = await res.json();

let sort = Math.max(0, ...catalog.models.filter((m) => m.cli === "openrouter").map((m) => m.sortOrder ?? 0));
const added = data
  .filter((m) => (m.created ?? 0) >= EPOCH && wanted(m.id) && !known.has(m.id))
  .sort((a, b) => b.created - a.created)
  .map((m) => ({
    id: m.id,
    cli: "openrouter",
    provider: "OpenRouter",
    name: m.name.replace(/^[^:]+:\s*/, ""),
    costIn: price(m.pricing?.prompt),
    costOut: price(m.pricing?.completion),
    ctx: ctx(m.context_length),
    bestFor: "OpenRouter 신규 모델",
    requiresOpenrouter: true,
    minCliVersion: null,
    aliases: [],
    defaultForSkills: [],
    tier: tier(m.pricing?.prompt),
    sortOrder: (sort += 1),
    active: true,
    deprecatedBy: null,
  }));

for (const m of added) console.log(`+ ${m.id.padEnd(40)} ${m.costIn.padEnd(12)} ${m.ctx}`);
console.log(`신규 ${added.length}개 (기존 ${catalog.models.length}개, revision ${catalog.revision})`);

if (!added.length || !APPLY) process.exit(0);
catalog.models.push(...added);
catalog.revision += 1;
catalog.updatedAt = new Date().toISOString().slice(0, 10);
writeFileSync(FILE, JSON.stringify(catalog, null, 2) + "\n");
console.log(`revision ${catalog.revision} 로 저장`);
