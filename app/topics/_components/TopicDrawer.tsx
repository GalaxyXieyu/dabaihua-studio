"use client";

import { useState } from "react";
import type { Topic } from "./Board";

type PublishData = {
  url: string;
  publishedDate?: string;
  reads?: number;
  likes?: number;
  collects?: number;
  shares?: number;
};

export function TopicDrawer({
  topic,
  saving,
  onClose,
  onSave,
  onAction,
  onSchedule,
  onPublish,
}: {
  topic: Topic;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onAction: (action: "approve" | "skip" | "unschedule") => void;
  onSchedule: (date: string) => void;
  onPublish: (data: PublishData) => void;
}) {
  const [form, setForm] = useState({
    title: topic.title || "",
    angle: topic.angle || "",
    platform: topic.platform || "",
    contentType: topic.contentType || "",
    series: topic.series || "",
    seriesOrder: topic.seriesOrder?.toString() || "",
    scheduledDate: topic.scheduledDate || "",
    notes: topic.notes || "",
  });

  const [scheduleDate, setScheduleDate] = useState("");
  const [publishForm, setPublishForm] = useState<PublishData>({
    url: "",
    publishedDate: "",
    reads: 0,
    likes: 0,
    collects: 0,
    shares: 0,
  });
  const [showPublish, setShowPublish] = useState(false);

  const update = (key: keyof typeof form, val: string) => setForm((prev) => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const patch: Record<string, unknown> = {
      title: form.title,
      angle: form.angle,
      platform: form.platform,
      contentType: form.contentType,
      series: form.series,
      seriesOrder: form.seriesOrder ? Number(form.seriesOrder) : null,
      notes: form.notes,
    };
    onSave(patch);
  };

  const handleSchedule = () => {
    if (!scheduleDate) return;
    onSchedule(scheduleDate);
    setScheduleDate("");
  };

  const handlePublish = () => {
    if (!publishForm.url) return;
    onPublish(publishForm);
    setShowPublish(false);
    setPublishForm({ url: "", publishedDate: "", reads: 0, likes: 0, collects: 0, shares: 0 });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="tp-drawer-backdrop" onClick={onClose} />

      {/* Drawer */}
      <aside className="tp-drawer">
        {/* Header */}
        <div className="tp-drawer-head">
          <div className="flex items-baseline gap-2">
            <span className="tp-drawer-title">编辑选题</span>
            <span className="tp-drawer-id">#{topic.id}</span>
          </div>
          <button onClick={onClose} className="tp-icon-button" aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="tp-drawer-body">
          {/* Title */}
          <div className="tp-field">
            <label htmlFor="topic-title">标题</label>
            <input
              id="topic-title"
              className="tp-input"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
            />
          </div>

          {/* Angle */}
          <div className="tp-field">
            <label htmlFor="topic-angle">切入角度</label>
            <textarea
              id="topic-angle"
              className="tp-textarea"
              rows={2}
              value={form.angle}
              onChange={(e) => update("angle", e.target.value)}
            />
          </div>

          {/* Platform & ContentType */}
          <div className="tp-grid-2">
            <div className="tp-field">
              <label htmlFor="topic-platform">平台</label>
              <select
                id="topic-platform"
                value={form.platform}
                onChange={(e) => update("platform", e.target.value)}
              >
                <option value="">未指定</option>
                <option value="gzh">公众号</option>
                <option value="xhs">小红书</option>
                <option value="x">X</option>
                <option value="bilibili">B站</option>
              </select>
            </div>
            <div className="tp-field">
              <label htmlFor="topic-content-type">内容类型</label>
              <select
                id="topic-content-type"
                value={form.contentType}
                onChange={(e) => update("contentType", e.target.value)}
              >
                <option value="">未指定</option>
                <option value="连载">连载</option>
                <option value="工具">工具</option>
                <option value="热点">热点</option>
                <option value="产品">产品</option>
              </select>
            </div>
          </div>

          {/* Series & SeriesOrder */}
          <div className="tp-grid-2">
            <div className="tp-field">
              <label htmlFor="topic-series">系列名称</label>
              <input
                id="topic-series"
                className="tp-input"
                value={form.series}
                onChange={(e) => update("series", e.target.value)}
                placeholder="如：AI工具测评"
              />
            </div>
            <div className="tp-field">
              <label htmlFor="topic-series-order">系列序号</label>
              <input
                id="topic-series-order"
                type="number"
                className="tp-input"
                value={form.seriesOrder}
                onChange={(e) => update("seriesOrder", e.target.value)}
                placeholder="如：1"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="tp-field">
            <label htmlFor="topic-notes">备注</label>
            <textarea
              id="topic-notes"
              className="tp-textarea"
              rows={3}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="写作笔记、参考链接等"
            />
          </div>

          {/* Divider */}
          <div className="tp-divider">
            {/* Score info */}
            <div className="tp-score-line">
              <span>总分 <b className="tp-num">{topic.total}</b></span>
              <span>热度 <span className="tp-num">{topic.heat}</span></span>
              <span>匹配 <span className="tp-num">{topic.matchScore}</span></span>
              <span>可行 <span className="tp-num">{topic.feasibility}</span></span>
              {topic.hkr && <span>{topic.hkr}</span>}
            </div>

            {/* Status actions */}
            <div className="tp-actions">
              {topic.status === "candidate" && (
                <>
                  <button
                    disabled={saving}
                    onClick={() => onAction("approve")}
                    className="tp-btn-primary"
                  >
                    入选
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => onAction("skip")}
                    className="tp-btn-secondary"
                  >
                    跳过
                  </button>
                </>
              )}
              {topic.status === "approved" && (
                <>
                  <input
                    type="date"
                    aria-label="排期日期"
                    className="tp-input flex-1"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                  <button
                    disabled={saving || !scheduleDate}
                    onClick={handleSchedule}
                    className="tp-btn-primary"
                  >
                    排期
                  </button>
                </>
              )}
              {topic.status === "scheduled" && (
                <>
                  <span className="tp-inline-meta">排期：<span className="tp-item-date">{topic.scheduledDate}</span></span>
                  <button
                    disabled={saving}
                    onClick={() => onAction("unschedule")}
                    className="tp-btn-secondary"
                  >
                    取消排期
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => setShowPublish(!showPublish)}
                    className="tp-btn-primary"
                  >
                    发布回填
                  </button>
                </>
              )}
              {topic.status === "published" && (
                <span className="tp-inline-meta">已发布</span>
              )}
            </div>

            {/* Publish form */}
            {showPublish && (
              <div className="tp-publish">
                <div className="tp-publish-title">发布回填</div>
                <input
                  placeholder="发布链接 URL"
                  aria-label="发布链接"
                  value={publishForm.url}
                  onChange={(e) => setPublishForm((p) => ({ ...p, url: e.target.value }))}
                />
                <div className="tp-grid-2">
                  <input
                    type="date"
                    aria-label="发布日期"
                    value={publishForm.publishedDate}
                    onChange={(e) => setPublishForm((p) => ({ ...p, publishedDate: e.target.value }))}
                  />
                  <input
                    type="number"
                    aria-label="阅读数"
                    placeholder="阅读数"
                    value={publishForm.reads}
                    onChange={(e) => setPublishForm((p) => ({ ...p, reads: Number(e.target.value) }))}
                  />
                  <input
                    type="number"
                    aria-label="点赞数"
                    placeholder="点赞数"
                    value={publishForm.likes}
                    onChange={(e) => setPublishForm((p) => ({ ...p, likes: Number(e.target.value) }))}
                  />
                  <input
                    type="number"
                    aria-label="收藏数"
                    placeholder="收藏数"
                    value={publishForm.collects}
                    onChange={(e) => setPublishForm((p) => ({ ...p, collects: Number(e.target.value) }))}
                  />
                  <input
                    type="number"
                    aria-label="分享数"
                    placeholder="分享数"
                    value={publishForm.shares}
                    onChange={(e) => setPublishForm((p) => ({ ...p, shares: Number(e.target.value) }))}
                  />
                </div>
                <div className="tp-actions">
                  <button
                    disabled={saving || !publishForm.url}
                    onClick={handlePublish}
                    className="tp-btn-primary"
                  >
                    确认发布
                  </button>
                  <button
                    onClick={() => setShowPublish(false)}
                    className="tp-btn-secondary"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="tp-meta">
            <div>创建于 {new Date(topic.createdAt).toLocaleString("zh-CN")}</div>
            {topic.updatedAt && <div>更新于 {new Date(topic.updatedAt).toLocaleString("zh-CN")}</div>}
            {topic.reason && <div className="mt-1">理由：{topic.reason}</div>}
          </div>
        </div>

        {/* Footer */}
        <div className="tp-drawer-foot">
          <button
            disabled={saving}
            onClick={handleSave}
            className="tp-btn-primary tp-btn-block"
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
        </div>
      </aside>
    </>
  );
}
