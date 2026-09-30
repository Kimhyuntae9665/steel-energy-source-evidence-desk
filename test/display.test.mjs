import test from 'node:test';import assert from 'node:assert/strict';import {loadDataset} from '../core.mjs';import {executeQuery} from '../policy.mjs';import {selectedDateMetric} from '../display.mjs';
test('invalid pre-selection scopes display unevaluated dates, while valid covered empty selection displays zero',async()=>{
 const dataset=await loadDataset(),base={schema_version:'P12-UCI851-QUERY-1',operation:'count_source_rows',source_labeled_date_from:null,source_labeled_date_to_exclusive:null,source_weekstatus:null,source_load_type:null,unavailable_topic:null};
 for(const [from,to,status]of[['2018-02-29','2018-03-01','invalid_calendar_date'],['2018-02-02','2018-02-01','invalid_date_range'],['2026-09-30','2026-10-01','period_not_in_historical_source'],['2017-12-31','2018-01-02','scope_not_fully_covered']]){
  const result=executeQuery(dataset,{...base,source_labeled_date_from:from,source_labeled_date_to_exclusive:to});assert.equal(result.status,status);assert.equal(selectedDateMetric({...result,selected_date_labels:[]}), 'Not evaluated');
 }
 const empty=executeQuery(dataset,{...base,source_labeled_date_from:'2018-01-01',source_labeled_date_to_exclusive:'2018-01-02',source_weekstatus:'Weekday',source_load_type:'Maximum_Load'});assert.equal(empty.status,'empty_selection');assert.equal(selectedDateMetric({...empty,selected_date_labels:[]}),0);
});
