export const COMMUNITY_CONTENT_PARSER = Symbol('COMMUNITY_CONTENT_PARSER');
export interface CommunityContentParser {
 parse(body:string): {assetIds:string[];links:{type:'article'|'resort';id:number}[];text:string};
}
/** Legacy-only programmatic callers fail closed if attempting Markdown without a parser. */
export const unavailableContentParser: CommunityContentParser = {parse(){throw new Error('Markdown parser is not configured');}};
