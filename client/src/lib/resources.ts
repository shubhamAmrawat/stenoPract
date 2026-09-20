import type { ResourceGroupKey } from './types'

export const RESOURCE_GROUPS: Record<ResourceGroupKey, { title: string; blurb: string; tag: string }> = {
  'kc-magazines': {
    title: 'KC Magazines PDF',
    blurb: 'Kailash Chandra dictation books, volume by volume.',
    tag: 'Kailash Chandra',
  },
  'ssc-previous-years': {
    title: 'SSC Steno previous years skill test matter',
    blurb: 'Past skill-test dictation matter for offline practice.',
    tag: 'Previous years',
  },
}

/** Google Drive share links do not download directly; turn them into a direct-download link. Everything else is used as is. */
export function downloadUrl(url: string): string {
  const m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/) ?? url.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/)
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url
}
