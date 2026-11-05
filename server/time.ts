// One-company v1 uses China accounting calendar dates; timestamps remain UTC timestamptz.
export const companyToday=(at=new Date())=>at.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
