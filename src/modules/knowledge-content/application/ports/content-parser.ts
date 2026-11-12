export const ARTICLE_CONTENT_PARSER = Symbol('ARTICLE_CONTENT_PARSER');
export interface ArticleContentParser {
 parse(body:string): {assetIds:string[];links:{type:'article'|'resort';id:number}[];text:string};
}
/** Legacy-only programmatic callers fail closed if attempting Markdown without a parser. */
export const unavailableContentParser: ArticleContentParser = {parse(){throw new Error('Markdown parser is not configured');}};
