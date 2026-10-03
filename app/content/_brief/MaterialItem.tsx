"use client";

import { useState } from "react";
import type { MaterialView } from "../../../lib/brief-view";
import { MiniMarkdown } from "./mini-markdown";

type BriefMaterial = {
  title: string;
  summary: string;
  url: string;
  links: Array<{ label: string; url: string }>;
};

type Props = {
  material: BriefMaterial;
  view: MaterialView | null;
  first: boolean;
};

/** One brief material: header toggles the body, the first one starts open. */
export function MaterialItem({ material, view, first }: Props) {
  const [open, setOpen] = useState(first);
  const [translated, setTranslated] = useState(false);

  const value: MaterialView =
    view ?? {
      url: material.url,
      itemId: null,
      site: "",
      title: material.title,
      translatedTitle: "",
      publishedLabel: "",
      body: "",
      summary: material.summary,
      translatedBody: "",
      hasText: false,
      missingReason: "",
    };

  const canTranslate = value.hasText && value.translatedBody.length > 0;
  const heading = translated && value.translatedTitle ? value.translatedTitle : value.title;

  return (
    <div className={`db-material ${open ? "is-open" : ""}`}>
      <div className="db-material-head">
        <button
          type="button"
          className="db-material-toggle"
          data-testid="brief-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {value.site && <span className="db-material-site">{value.site}</span>}
          <span className="db-material-name">{heading}</span>
          {value.publishedLabel && <time className="db-material-date">{value.publishedLabel}</time>}
        </button>
        {canTranslate && open && (
          <span className="db-material-translate" role="group" aria-label="原文或译文">
            <button
              type="button"
              data-testid="brief-material-original"
              className={!translated ? "is-on" : ""}
              onClick={() => setTranslated(false)}
            >
              原文
            </button>
            <button
              type="button"
              data-testid="brief-material-translated"
              className={translated ? "is-on" : ""}
              onClick={() => setTranslated(true)}
            >
              译文
            </button>
          </span>
        )}
      </div>

      {open && (
        <div className="db-material-body">
          {canTranslate && translated ? (
            <>
              <p className="db-material-note">中文摘要</p>
              <MiniMarkdown text={value.translatedBody} />
            </>
          ) : value.hasText ? (
            <MiniMarkdown text={value.body} />
          ) : (
            <>
              {value.summary && <MiniMarkdown text={value.summary} />}
              <p className="db-material-missing">
                原文没抓到{value.missingReason ? ` · ${value.missingReason}` : ""}
              </p>
            </>
          )}

          <p className="db-material-links">
            {value.url && (
              <a href={value.url} target="_blank" rel="noopener noreferrer">
                打开原网页
              </a>
            )}
            {value.itemId !== null && (
              <a href={`/discover?item=${value.itemId}`} data-testid="brief-material-reader-link">
                在阅读中打开
              </a>
            )}
            {material.links.map((link, index) => (
              <a key={index} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label || link.url}
              </a>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
