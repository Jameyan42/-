export type FieldKey='type'|'number'|'code'|'date'|'buyerName'|'buyerTaxId'|'sellerName'|'sellerTaxId'|'netAmount'|'taxAmount'|'amount'|'itemName';
export type Box=number[][]|null;
export type RecognizedLine={text:string;score?:number|null;box?:Box};
export type FieldResult={label:string;value:string;rawValue:string;confidence:number|null;status:'MISSING'|'AMBIGUOUS'|'CANDIDATE'|'LOW_CONFIDENCE'|'INVALID';reason:string;alternatives:string[];evidence:{lineId:string;text:string;box:Box}[]};
export type RecognitionResult={schema:1;engine:string;source:'PDF_TEXT'|'LOCAL_CPU_OCR'|'BROWSER_OCR';page:number;elapsedMs:number;text:string;lines:{id:string;text:string;score:number|null;box:Box}[];fields:Record<FieldKey,FieldResult>;rawInvoiceType:string;warnings:string[];taxVerified:false;globalConfidence?:number};
export const invoiceFields:[FieldKey,string][];
export function normalizeLines(lines:RecognizedLine[]):unknown[];
export function extractStructuredInvoice(lines:RecognizedLine[],options?:{engine?:string;source?:RecognitionResult['source'];elapsedMs?:number;page?:number}):RecognitionResult;
