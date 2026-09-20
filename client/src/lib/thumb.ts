/** YouTube serves a thumbnail for any public video id; nothing is stored on our side. */
export const thumbUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
