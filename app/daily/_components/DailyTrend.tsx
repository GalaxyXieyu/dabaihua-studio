"use client";

import { useEffect, useRef, useState } from "react";

export type TrendPoint = { date: string; label: string; commits: number; tokensM: number | null };

const H_DESKTOP = 240;
const H_MOBILE = 160;
const PAD = { left: 44, right: 44, top: 12, bottom: 34 };
const MIN_W = 320;
const DEFAULT_W = 720;
const TOOLTIP_H = 76;
const LABEL_MIN_GAP = 34;

function formatToken(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Number(value.toFixed(1)));
}

function formatAxis(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return String(Math.round(value));
  return String(Number(value.toFixed(1)));
}

function formatDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

/**
 * 最近 30 天的提交柱 + token 线。纯 SVG，无图表依赖；悬停出数字，点击切换当天。
 * viewBox 宽度跟随容器实测宽度，让 11px 的文字在手机上也是实打实的 11px。
 */
export function DailyTrend({ points, selected }: { points: TrendPoint[]; selected: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(DEFAULT_W);
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = plotRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setWidth(Math.max(MIN_W, Math.round(element.clientWidth) || DEFAULT_W));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) return null;

  const W = width;
  // 手机首屏：压缩图表高度，底部日期标签不会被固定标签栏盖住。
  const narrow = W < 520;
  const H = narrow ? H_MOBILE : H_DESKTOP;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;
  // 柱子数量就是实际天数，日报少时也撑满整幅图，不留一大段空轴。
  const slots = Math.max(1, points.length);
  const column = plotW / slots;
  const barWidth = Math.max(6, column * 0.54);
  const maxCommits = Math.max(1, ...points.map((point) => point.commits));
  const tokenValues = points
    .map((point) => point.tokensM)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const maxTokens = tokenValues.length > 0 ? Math.max(1, ...tokenValues) : 1;

  const dotX = (index: number) => PAD.left + column * (index + 0.5);
  const commitY = (commits: number) => baseY - (commits / maxCommits) * plotH;
  const tokenY = (tokens: number) => baseY - (tokens / maxTokens) * plotH;

  const lineSegments: string[] = [];
  const dots: Array<{ x: number; y: number }> = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.tokensM == null || !Number.isFinite(point.tokensM)) {
      if (current.length > 1) lineSegments.push(current.join(" "));
      current = [];
      return;
    }
    const x = dotX(index);
    const y = tokenY(point.tokensM);
    dots.push({ x, y });
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) lineSegments.push(current.join(" "));

  const active = hover == null ? null : points[hover];
  const hoverX = hover == null ? 0 : dotX(hover);
  const hoverTop = hover == null ? 0 : commitY(points[hover].commits);
  const tooltipHalf = 86;
  const tooltipLeft = Math.min(Math.max(hoverX, tooltipHalf), Math.max(tooltipHalf, W - tooltipHalf));
  const tooltipTop = Math.max(0, hoverTop - TOOLTIP_H - 8);

  // 日期标签按可用宽度抽稀：保首尾、当前选中和固定间隔，窄屏也不重叠。
  const labelBudget = Math.max(2, Math.floor(plotW / (narrow ? 40 : 52)));
  const labelStep = Math.max(1, Math.ceil(points.length / labelBudget));
  const showLabel = new Array<boolean>(points.length).fill(false);
  const keptX: number[] = [];
  const claimLabel = (index: number) => {
    if (index < 0 || index >= points.length || showLabel[index]) return;
    const x = dotX(index);
    if (keptX.every((kept) => Math.abs(kept - x) >= LABEL_MIN_GAP)) {
      showLabel[index] = true;
      keptX.push(x);
    }
  };
  claimLabel(points.length - 1);
  claimLabel(points.findIndex((point) => point.date === selected));
  claimLabel(0);
  for (let index = 0; index < points.length; index += labelStep) claimLabel(index);

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
      <div className="daily-a-trend-plot" ref={plotRef} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`最近 ${points.length} 天的提交数与 token 趋势`}>
          <line x1={PAD.left} y1={baseY} x2={W - PAD.right} y2={baseY} className="daily-a-axis" />
          <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" className="daily-a-axis-label">
            {maxCommits}
          </text>
          <text x={PAD.left - 8} y={baseY} textAnchor="end" className="daily-a-axis-label">
            0
          </text>
          <text x={W - PAD.right + 8} y={PAD.top + 4} textAnchor="start" className="daily-a-axis-label is-token">
            {formatAxis(maxTokens)}
          </text>
          <text x={W - PAD.right + 8} y={baseY} textAnchor="start" className="daily-a-axis-label is-token">
            0
          </text>
          {points.map((point, index) => {
            const x = dotX(index);
            const height = (point.commits / maxCommits) * plotH;
            const isSelected = point.date === selected;
            return (
              <g key={point.date}>
                <rect
                  x={x - barWidth / 2}
                  y={baseY - height}
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
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(index)}
                  />
                </a>
                {showLabel[index] ? (
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
          {dots.map((dot, index) => (
            <circle key={`dot-${index}`} cx={dot.x} cy={dot.y} r={2.6} className="daily-a-line-dot" />
          ))}
        </svg>
        {active ? (
          <div className="daily-a-tooltip" style={{ left: `${tooltipLeft}px`, top: `${tooltipTop}px` }}>
            <span className="daily-a-tooltip-date">{formatDay(active.date)}</span>
            <span className="daily-a-tooltip-row">提交 {active.commits}</span>
            <span className="daily-a-tooltip-row">token {formatToken(active.tokensM)} 百万</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
