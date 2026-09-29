/**
 * 轻量 i18n · 不引第三方库
 *
 * 拆分策略：
 * - 默认语言 zh 静态 import（UI 启动即用 · 零延迟）
 * - 非默认语言 en 动态 import（用户切到 en 时才 fetch 独立 chunk）
 * - 缺 key fallback 到中文
 * - localStorage 持久化 · 默认 zh
 */

import { useEffect, useState } from 'react';
import zhDict from './locales/zh.json';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'ds.lang';

type Dict = Record<string, string>;

/** 当前已加载的字典缓存 · zh 同步可用 · en async */
const loaded: Record<Lang, Dict | null> = {
  zh: zhDict,
  en: null,
};
/** 防止重复 import 同语言 */
const inflight: Record<Lang, Promise<void> | null> = {
  zh: Promise.resolve(),
  en: null,
};

async function ensureLangLoaded(lang: Lang): Promise<void> {
  if (loaded[lang]) return;
  if (lang === 'en') {
    if (!inflight.en) {
      inflight.en = import('./locales/en.json').then((m) => {
        loaded.en = m.default;
      });
    }
    await inflight.en;
  }
}

let _lang: Lang = 'zh';
const listeners = new Set<() => void>();

function loadInitial(): Lang {
  if (typeof window === 'undefined') return 'zh';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return 'zh';
}

if (typeof window !== 'undefined') {
  _lang = loadInitial();
  // 如果用户上次选的是 en · 立即 prefetch（异步 · 不阻塞 UI）
  if (_lang === 'en') void ensureLangLoaded('en');
}

export function getLang(): Lang {
  return _lang;
}

/**
 * 切换语言 · 自动预加载目标字典
 * 异步是因为 en 需要 dynamic import
 */
export async function setLang(lang: Lang): Promise<void> {
  await ensureLangLoaded(lang);
  if (_lang === lang) return;
  _lang = lang;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, lang);
  }
  listeners.forEach((fn) => fn());
}

/** 模板插值：t('cam.distance', { d: 4 }) → "距离 4m" / "Distance 4m" */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/**
 * 同步拿字符串 · 当前 lang 没加载完成时 fallback 到 zh
 */
export function tSync(key: string, vars?: Record<string, string | number>): string {
  const lang = _lang;
  let raw = loaded[lang]?.[key];
  if (raw === undefined && lang !== 'zh') {
    raw = loaded.zh?.[key];
  }
  if (raw === undefined) return key;
  return vars ? format(raw, vars) : raw;
}

/** React hook · 组件订阅语言变化 */
export function useT() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return tSync;
}

export function useLang(): [Lang, (lang: Lang) => Promise<void>] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [_lang, setLang];
}