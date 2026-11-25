const test = require('node:test');
const assert = require('node:assert');
const { plan } = require('../student-details/fresh-start');

test('fresh start keeps six details, drops no-contact and test students (made-up data)', () => {
  const wb = { sheets: [{ id: 's', name: 'S', columns: [], rows: [
    { _id: 'a', 'FIRST NAME': 'Asha', 'LAST NAME': 'Rai', EMAIL: 'a@x.test', 'CONTACT NUMBER': '98', 'NOC NUMBER': '1', 'APPLICATION STATUS': 'Offer', 'STUDENT SOURCE': 'Visitor', 'UNIVERSITY NAME': 'U', REMARKS: 'r' },
    { _id: 'b', 'FIRST NAME': 'Bo', 'LAST NAME': 'Li', 'CONTACT NUMBER': ' ' },
    { _id: 'c', 'FIRST NAME': 'test', 'LAST NAME': 'tt', 'CONTACT NUMBER': '5' },
  ] }] };
  const p = plan(wb);
  assert.equal(p.kept, 1); assert.equal(p.removed.length, 2);
  assert.deepEqual(p.sheets[0].rows[0], { _id: 'a', 'FIRST NAME': 'Asha', 'LAST NAME': 'Rai', EMAIL: 'a@x.test', 'CONTACT NUMBER': '98', 'NOC NUMBER': '1', 'APPLICATION STATUS': 'Offer', 'STUDENT SOURCE': 'Visitor' });
});
