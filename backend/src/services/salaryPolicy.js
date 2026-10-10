// This threshold is a data-entry warning, not a statutory minimum wage.
const REVIEW_MONTHLY_SALARY_BELOW = 1000000;
const isUnverifiedLowMonthlySalary = (salaryConfig = {}) => {
  const amount = Number(salaryConfig.baseSalary);
  return amount > 0 && amount < REVIEW_MONTHLY_SALARY_BELOW && salaryConfig.lowMonthlySalaryConfirmed !== true;
};

module.exports = { REVIEW_MONTHLY_SALARY_BELOW, isUnverifiedLowMonthlySalary };
