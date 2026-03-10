function computePaymentStatus(totalAmount, customerAmount, insuranceAmount) {
  const billed = Number(totalAmount || 0);
  const totalCollected = Number(customerAmount || 0) + Number(insuranceAmount || 0);
  const balance = Math.max(billed - totalCollected, 0);

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
