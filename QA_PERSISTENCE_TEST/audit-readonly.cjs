// SELECT only. Writes evidence files locally; never writes Cassandra.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cassandra = require('cassandra-driver');
const root = __dirname;
const evidence = path.join(root, 'MinhChung');
const client = new cassandra.Client({ contactPoints: ['127.0.0.1'], localDataCenter: 'datacenter1', protocolOptions: { port: 9042 }, queryOptions: { consistency: cassandra.types.consistencies.localOne }, socketOptions: { connectTimeout: 5000, readTimeout: 10000 } });
const log = { startedAt: new Date().toISOString(), mode: 'READ_ONLY_NO_RESTART', queries: [], checks: [] };
async function select(cql, params = []) {
  if (!/^SELECT\s/i.test(cql)) throw Error('Only SELECT permitted');
  const r = await client.execute(cql, params, { prepare: true });
  const rows = JSON.parse(JSON.stringify(r.rows));
  log.queries.push({ at: new Date().toISOString(), cql, params, rows, hasMorePages: !!r.pageState });
  return rows;
}
function check(name, ok, details) { log.checks.push({ name, result: ok ? 'PASS' : 'FAIL', details }); }
async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  try {
    await client.connect();
    await select('SELECT cluster_name,release_version,data_center,host_id FROM system.local');
    const ks = await select('SELECT keyspace_name,durable_writes,replication FROM system_schema.keyspaces WHERE keyspace_name = ?', ['dat_xe_cong_nghe']);
    check('Durable writes enabled', ks[0]?.durable_writes === true, ks[0]);
    const columns = await select('SELECT table_name,column_name,kind,position,type FROM system_schema.columns WHERE keyspace_name = ?', ['dat_xe_cong_nghe']);
    const tables = await select('SELECT table_name,default_time_to_live FROM system_schema.tables WHERE keyspace_name = ?', ['dat_xe_cong_nghe']);
    check('Live schema readable', columns.length > 0, { tables: tables.length, columns: columns.length });
    // Identify existing records only, not newly generated QA records.
    const trips = await select('SELECT trip_id,customer_id,driver_id,vehicle_id,booked_at,status,final_fare FROM dat_xe_cong_nghe.trips_by_id LIMIT 30');
    const trip = trips.find(t => t.status === 'COMPLETED') || trips[0];
    if (trip) {
      log.existingSampleIds = { ...trip, purpose: 'EXISTING_DATA_BASELINE_NOT_QA_CREATED' };
      const id = n => cassandra.types.Uuid.fromString(trip[n]);
      const at = new Date(trip.booked_at);
      const customer = await select('SELECT customer_id,status FROM dat_xe_cong_nghe.customers WHERE customer_id = ?', [id('customer_id')]);
      const driver = await select('SELECT driver_id,account_status,driver_status FROM dat_xe_cong_nghe.drivers WHERE driver_id = ?', [id('driver_id')]);
      const vehicle = await select('SELECT vehicle_id,driver_id,status FROM dat_xe_cong_nghe.vehicles WHERE vehicle_id = ?', [id('vehicle_id')]);
      check('Existing trip links', !!customer.length && !!driver.length && vehicle[0]?.driver_id === trip.driver_id, { tripId: trip.trip_id });
      for (const [table, owner] of [['trips_by_customer','customer_id'],['trips_by_driver','driver_id']]) {
        const rows = await select(`SELECT * FROM dat_xe_cong_nghe.${table} WHERE ${owner} = ? AND booked_at = ? AND trip_id = ?`, [id(owner), at, id('trip_id')]);
        check(`Existing ${table} status/fare`, rows.length === 1 && rows[0].status === trip.status && Number(rows[0].final_fare) === Number(trip.final_fare), { tripId: trip.trip_id });
      }
      const status = await select('SELECT * FROM dat_xe_cong_nghe.trips_by_status WHERE status = ? AND trip_date = ? AND booked_at = ? AND trip_id = ?', [trip.status, cassandra.types.LocalDate.fromDate(at), at, id('trip_id')]);
      check('Existing status projection', status.length === 1, { tripId: trip.trip_id });
      const payments = await select('SELECT * FROM dat_xe_cong_nghe.payments_by_trip WHERE trip_id = ?', [id('trip_id')]);
      for (const p of payments) {
        const rows = await select('SELECT * FROM dat_xe_cong_nghe.payments_by_customer WHERE customer_id = ? AND paid_at = ? AND payment_id = ?', [id('customer_id'), new Date(p.paid_at), cassandra.types.Uuid.fromString(p.payment_id)]);
        check('Existing payment projection', rows.length === 1 && rows[0].trip_id === trip.trip_id && rows[0].payment_status === p.payment_status && Number(rows[0].amount) === Number(p.amount), { paymentId: p.payment_id });
        if (['PAID','PAID_DEMO'].includes(p.payment_status)) {
          const paidAt = new Date(p.paid_at), month = p.paid_at.slice(0,7), date = cassandra.types.LocalDate.fromDate(paidAt);
          for (const [table, owner, money] of [['driver_revenue_by_month','driver_id','fare'],['customer_spending_by_month','customer_id','amount']]) {
            const rows = await select(`SELECT * FROM dat_xe_cong_nghe.${table} WHERE ${owner} = ? AND year_month = ? AND trip_date = ? AND trip_id = ?`, [id(owner), month, date, id('trip_id')]);
            check(`Existing ${table}`, rows.length === 1 && Number(rows[0][money]) === Number(p.amount), { tripId: trip.trip_id, month });
          }
        }
      }
      const reviews = await select('SELECT * FROM dat_xe_cong_nghe.reviews_by_trip WHERE trip_id = ?', [id('trip_id')]);
      for (const review of reviews) {
        const rows = await select('SELECT * FROM dat_xe_cong_nghe.reviews_by_driver WHERE driver_id = ? AND created_at = ? AND review_id = ?', [id('driver_id'), new Date(review.created_at), cassandra.types.Uuid.fromString(review.review_id)]);
        check('Existing review projection', rows.length === 1 && rows[0].trip_id === trip.trip_id && rows[0].rating === review.rating, { reviewId: review.review_id });
      }
      await select('SELECT * FROM dat_xe_cong_nghe.trip_status_history WHERE trip_id = ?', [id('trip_id')]);
    }
    // Inventory all application source bytes without executing application code.
    const inventory = [];
    function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir,e.name); if (e.isDirectory()) walk(file); else {const data=fs.readFileSync(file);inventory.push({file:path.relative(path.dirname(root),file),bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});} } }
    walk(path.join(path.dirname(root),'src'));
    log.sourceInventory = inventory;
  } catch (error) { log.error = error.message; process.exitCode = 1; }
  finally { await client.shutdown(); log.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(evidence,'SELECT_Baseline.json'), JSON.stringify(log,null,2)); console.log(JSON.stringify({queries:log.queries.length,checks:log.checks,existingSampleIds:log.existingSampleIds,error:log.error},null,2)); }
}
main();
