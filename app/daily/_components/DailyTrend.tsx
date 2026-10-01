"use client";

import { useState } from "react";

export type TrendPoint = { date: string; label: string; commits: number; tokensM: number | null };

const W = 720;
const H = 220;
const PAD = { left: 40, right: 12, top: 26, bottom: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const BASE_Y = PAD.top + PLOT_H;

function formatToken(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Number(value.toFixed(1)));
}

function formatDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

/**
 * 最近 30 天的提交柱 + token 线。纯 SVG，无图表依赖；悬停出数字，点击切换当天。
 */
export function DailyTrend({ points, selected }: { points: TrendPoint[]; selected: string }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) return null;

  const column = PLOT_W / points.length;
  const barWidth = Math.max(2, column * 0.5);
  const maxCommits = Math.max(1, ...points.map((point) => point.commits));
  const tokens = points.map((point) => point.tokensM).filter((value): value is number => value != null && Number.isFinite(value));
  const maxTokens = tokens.length > 0 ? Math.max(1, ...tokens) : 1;

  const lineSegments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.tokensM == null || !Number.isFinite(point.tokensM)) {
      if (current.length > 1) lineSegments.push(current.join(" "));
      current = [];
      return;
    }
    const x = PAD.left + column * (index + 0.5);
    const y = BASE_Y - (point.tokensM / maxTokens) * PLOT_H;
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) lineSegments.push(current.join(" "));

  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const active = hover == null ? null : points[hover];

  return (
    <div className="daily-a-trend">
      <div className="daily-a-legend" aria-hidden="true">
        <span className="daily-a-legend-item">
          <span className="daily-a-legend-bar" />提交
        </span>
        <span className="daily-a-legend-item">
          <span className="daily-a-legend-line" />token（百万）
        </span>
      </div>
      <div className="daily-a-trend-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="最近 30 天的提交数与 token 趋势">
          <line x1={PAD.left} y1={BASE_Y} x2={W - PAD.right} y2={BASE_Y} className="daily-a-axis" />
          <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" className="daily-a-axis-label">
            {maxCommits}
          </text>
          <text x={PAD.left - 8} y={BASE_Y} textAnchor="end" className="daily-a-axis-label">
            0
          </text>
          {points.map((point, index) => {
            const x = PAD.left + column * (index + 0.5);
            const height = (point.commits / maxCommits) * PLOT_H;
            const isSelected = point.date === selected;
            return (
              <g key={point.date}>
                <rect
                  x={x - barWidth / 2}
                  y={BASE_Y - height}
                  width={barWidth}
                  height={Math.max(1, height)}
                  className={`daily-a-bar ${isSelected ? "is-selected" : ""} ${hover === index ? "is-hover" : ""}`}
                />
                <a
                  href={`/daily?date=${point.date}`}
                  aria-label={`${formatDay(point.date)}：${point.commits} 个提交，${formatToken(point.tokensM)} 百万 token`}
                >
                  <rect
                    x={PAD.left + column * index}
                    y={PAD.top}
                    width={column}
                    height={PLOT_H}
                    fill="transparent"
                    onMouseEnter={() => setHover(index)}
                  />
                </a>
                {index % labelStep === 0 || isSelected ? (
                  <text x={x} y={H - 12} textAnchor="middle" className={`daily-a-axis-label ${isSelected ? "is-selected" : ""}`}>
                    {formatDay(point.date).replace(" 月 ", "/").replace(" 日", "")}
                  </text>
                ) : null}
              </g>
            );
          })}
          {lineSegments.map((segment, index) => (
            <polyline key={index} points={segment} className="daily-a-line" />
          ))}
        </svg>
        {active ? (
          <div
            className="daily-a-tooltip"
            style={{ left: `${((PAD.left + column * (hover! + 0.5)) / W) * 100}%` }}
          >
            <span className="daily-a-tooltip-date">{formatDay(active.date)}</span>
            <span className="daily-a-tooltip-row">提交 {active.commits}</span>
            <span className="daily-a-tooltip-row">token {formatToken(active.tokensM)} 百万</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
