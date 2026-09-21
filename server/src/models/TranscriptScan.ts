import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One scanned page (a whole exercise, or one page of an exercise that runs over two) sent to Claude to be read.
 * The page image is kept only until the transcript is approved or discarded, so the admin can review the text beside it.
 */
const transcriptScanSchema = new Schema(
  {
    setId: { type: Schema.Types.ObjectId, ref: 'DictationSet', required: true, index: true },
    fileName: { type: String, default: '' },
    pageNo: { type: Number, default: 1 },
    /** waiting = read, but it is half an exercise and needs its neighbouring page before it can be filed. */
    status: { type: String, enum: ['queued', 'running', 'waiting', 'done', 'failed'], default: 'queued', index: true },
    /** Pages of one uploaded file share an id, so an exercise printed over two pages can be joined (and two uploads of one file never mix). */
    uploadId: { type: String, default: '', index: true },
    /** How many pages the uploaded file has (1 for a single picture). */
    pages: { type: Number, default: 1 },
    /** whole = heading and footer on this page; start = heading but the exercise runs on; continuation = no heading, the rest of an exercise. */
    part: { type: String, enum: ['whole', 'start', 'continuation'] },
    /** On a continuation page: the scan of the exercise's first page, which carries the transcript. */
    joinedInto: { type: Schema.Types.ObjectId, ref: 'TranscriptScan', index: true },
    error: String,
    /** The JPEG that was sent to Claude. Removed once the scan is approved or discarded. */
    image: Buffer,

    exerciseNo: Number,
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation' },
    /** The draft transcript version created from this scan (absent when the scan matched the live transcript exactly). */
    textId: { type: Schema.Types.ObjectId, ref: 'DictationText' },
    /** draft = a new draft version awaits review; identical = the text equals the live transcript; none = nothing was created. */
    outcome: { type: String, enum: ['draft', 'identical', 'none'] },
    review: { type: String, enum: ['pending', 'approved'], default: 'pending' },

    reading: { type: Schema.Types.Mixed },
    checks: { type: Schema.Types.Mixed },
    /** Word differences from the transcript that was live when the scan ran (empty when identical or when none was live). */
    compare: { type: Schema.Types.Mixed },
    usage: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Scans (and any image left in them) are throw-away: clear them out after 45 days.
transcriptScanSchema.index({ createdAt: 1 }, { expireAfterSeconds: 45 * 24 * 60 * 60 });

export type TranscriptScanDoc = InferSchemaType<typeof transcriptScanSchema>;
export const TranscriptScan = model('TranscriptScan', transcriptScanSchema);
