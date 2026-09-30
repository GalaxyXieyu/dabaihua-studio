/**
 * Pure merge rule for weak topic-material imports.
 *
 * 晴儿简报素材与 topics.json / 推荐选题依据素材经常没有原标题，导入时用摘要
 * 第一句顶替。这类弱素材在更新已存在的「今日干货」条目时只能填空，绝不能
 * 覆盖已存的原文标题、中文标题、摘要、正文、作者或发布时间。真正的
 * 「今日干货」条目走 importTopicMaterials 里的强更新逻辑，不受此规则影响。
 */

export type MaterialMergeFields = {
  title: string;
  translatedTitle: string | null;
  originalExcerpt: string | null;
  translatedExcerpt: string | null;
  contentMarkdown: string;
  author: string | null;
  publishedAt: string | null;
};

const isEmpty = (value: string | null | undefined) => !String(value ?? "").trim();

/** 只填补 existing 为空的字段，返回合并后的完整字段。 */
export function mergeWeakMaterial(existing: MaterialMergeFields, incoming: MaterialMergeFields): MaterialMergeFields {
  return {
    title: isEmpty(existing.title) ? incoming.title : existing.title,
    translatedTitle: isEmpty(existing.translatedTitle) ? incoming.translatedTitle : existing.translatedTitle,
    originalExcerpt: isEmpty(existing.originalExcerpt) ? incoming.originalExcerpt : existing.originalExcerpt,
    translatedExcerpt: isEmpty(existing.translatedExcerpt) ? incoming.translatedExcerpt : existing.translatedExcerpt,
    contentMarkdown: isEmpty(existing.contentMarkdown) ? incoming.contentMarkdown : existing.contentMarkdown,
    author: isEmpty(existing.author) ? incoming.author : existing.author,
    publishedAt: isEmpty(existing.publishedAt) ? incoming.publishedAt : existing.publishedAt,
  };
}
