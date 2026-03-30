function computePaymentStatus(totalAmount, customerAmount, insuranceAmount) {
  const billed         = Number(totalAmount || 0);
  const rawCollected   = Number(customerAmount || 0) + Number(insuranceAmount || 0);
  // Never let collected exceed the billed amount (prevents dashboard totals from
  // inflating when the same payment sheet is uploaded more than once).
  const totalCollected = billed > 0 ? Math.min(rawCollected, billed) : rawCollected;
  const balance        = Math.max(billed - totalCollected, 0);

  let status = 'Pending';
  if (totalCollected > 0 && balance > 0) status = 'Partial';
  if (billed > 0 && balance === 0) status = 'Completed';

  return {
    total_collected: totalCollected,
    balance,
    status,
  };
}

module.exports = { computePaymentStatus };
