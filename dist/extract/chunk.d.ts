/** Split material text into overlapping chunks on line boundaries. */
export interface Chunk {
    index: number;
    start: number;
    end: number;
    text: string;
}
export declare function chunkText(text: string, maxChars: number, overlapChars: number): Chunk[];
