
export const abbreviateDate = (dateStr: string): string => {
  if (!dateStr) return '';
  
  const monthMap: { [key: string]: string } = {
    'january': 'Jan',
    'february': 'Feb',
    'march': 'Mar',
    'april': 'Apr',
    'may': 'May',
    'june': 'Jun',
    'july': 'Jul',
    'august': 'Aug',
    'september': 'Sep',
    'october': 'Oct',
    'november': 'Nov',
    'december': 'Dec'
  };

  let result = dateStr;
  Object.keys(monthMap).forEach(month => {
    const regex = new RegExp(`\\b${month}\\b`, 'gi');
    result = result.replace(regex, monthMap[month]);
  });

  return result;
};
