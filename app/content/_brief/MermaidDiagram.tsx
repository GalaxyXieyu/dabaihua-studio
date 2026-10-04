// mermaid 草图的浏览器端懒加载渲染：服务端不 import mermaid，只有 useEffect 里
// 才动态 import 并用 securityLevel strict 渲染。渲染失败时显示源码和「重画」。

"use client";

import { useEffect, useRef, useState } from "react";

type MermaidApi = (typeof import("mermaid"))["default"];

/** 模块级缓存 mermaid 的加载 promise，只在浏览器里创建。 */
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          primaryColor: "#FBF8F1",
          mainBkg: "#FBF8F1",
          primaryTextColor: "#1B1915",
          textColor: "#1B1915",
          primaryBorderColor: "#BA9500",
          nodeBorder: "#BA9500",
          lineColor: "#BA9500",
          secondaryColor: "#F4EADC",
          tertiaryColor: "#FBF8F1",
          edgeLabelBackground: "#FBF8F1",
          clusterBkg: "#FBF8F1",
          clusterBorder: "#BA9500",
          fontSize: "14px",
          background: "#FBF8F1",
          fontFamily: "Noto Serif SC Variable, Songti SC, STSong, Source Han Serif SC, serif",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** mermaid.render 需要一个全局唯一且合法的元素 id。 */
let renderSeq = 0;

const REDRAW_LABEL = "重画";

type Props = {
  /** 图的 blockId，例如 fig-1。 */
  blockId: string;
  source: string;
  /** 渲染失败时点「重画」回写该图的 feedback。 */
  onRedraw: () => void;
};

/** 外层用 key 换源码时重挂内层，避免在 effect 里同步重置状态。 */
export function MermaidDiagram(props: Props) {
  return <MermaidCanvas key={`${props.blockId}:${props.source}`} {...props} />;
}

function MermaidCanvas({ blockId, source, onRedraw }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"rendering" | "done" | "failed">("rendering");

  useEffect(() => {
    let cancelled = false;
    const elementId = `ol-mermaid-${blockId}-${renderSeq}`;
    renderSeq += 1;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(elementId, source);
        if (cancelled) return;
        if (containerRef.current) containerRef.current.innerHTML = svg;
        setStatus("done");
      } catch {
        if (cancelled) return;
        setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blockId, source]);

  if (status === "failed") {
    return (
      <div className="ol-mermaid ol-mermaid-failed" data-testid={`outline-mermaid-${blockId}`}>
        <pre className="ol-mermaid-source">{source}</pre>
        <button type="button" className="ol-text-btn" onClick={onRedraw}>
          {REDRAW_LABEL}
        </button>
      </div>
    );
  }

  return (
    <div className="ol-mermaid" data-testid={`outline-mermaid-${blockId}`}>
      {status === "rendering" && <div className="ol-mermaid-placeholder" aria-hidden="true" />}
      <div className="ol-mermaid-svg" ref={containerRef} />
    </div>
  );
}
