/** Export a published schema and its instances as Turtle (OWL + SHACL) or JSON-LD. */
import type { OntologySchema } from './schema.js';
import type { EvidenceRecord, LinkRecord, ObjectRecord } from './store.js';
export interface ExportData {
    /** Namespace IRI ending in `/` or `#`. */
    base: string;
    version: number;
    schema: OntologySchema;
    objects: ObjectRecord[];
    links: LinkRecord[];
    evidence: EvidenceRecord[];
}
export declare function toTurtle(data: ExportData): string;
export declare function toJsonLd(data: ExportData): Record<string, unknown>;
