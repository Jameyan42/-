// Conservative extraction: only explicit party labels or unambiguous party sections.
export function extractInvoiceDetails(text, base = {}) {
  const t = String(text || "").normalize("NFKC"),
    lines = t
      .split(/[\r\n]+/)
      .map((x) => x.trim())
      .filter(Boolean),
    hits = {};
  const push = (k, v) => {
    if (v) (hits[k] ??= []).push(v.trim());
  };
  let party = "";
  for (const line of lines) {
    const compact = line.replace(/[ \t]/g, "");
    if (/^(购买方|购方|Buyer)\s*[:：]?$/i.test(line)) party = "buyer";
    else if (/^(销售方|销方|Seller)\s*[:：]?$/i.test(line)) party = "seller";
    else if (/^(项目|货物|服务|价税|合计|备注)/.test(compact)) party = "";
    for (const [prefix, pattern] of [
      ["buyer", /(?:购买方|购方|Buyer)/i],
      ["seller", /(?:销售方|销方|Seller)/i],
    ]) {
      const explicitName = compact.match(
        new RegExp(
          pattern.source +
            "(?:名称|Name)[:：]([^:：]+?)(?=(?:购买方|购方|销售方|销方|Buyer|Seller|税号|TaxID)|$)",
          "i",
        ),
      );
      if (explicitName) push(prefix + "Name", explicitName[1]);
      const explicitTax = compact.match(
        new RegExp(
          pattern.source +
            "(?:纳税人识别号|税号|TaxID)[:：]([A-Z0-9-]{6,24})(?![A-Z0-9-])",
          "i",
        ),
      );
      if (explicitTax) push(prefix + "TaxId", explicitTax[1].toUpperCase());
    }
    if (party) {
      const n = line.match(/^(?:名称|Name)\s*[:：]\s*(.+)$/i),
        tax = compact.match(
          /^(?:纳税人识别号|税号|TaxID)[:：]([A-Z0-9-]{6,24})(?![A-Z0-9-])/i,
        );
      if (n) push(party + "Name", n[1]);
      if (tax) push(party + "TaxId", tax[1].toUpperCase());
    }
    const code = compact.match(
      /(?:发票代码|InvoiceCode)[:：]?(\d{10}(?:\d{2})?)(?!\d)/i,
    );
    if (code) push("code", code[1]);
    const d = compact.match(
      /(?:开票日期|InvoiceDate)[:：]?(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/i,
    );
    if (d) {
      const val = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
      if (
        !Number.isNaN(Date.parse(val)) &&
        new Date(val).toISOString().slice(0, 10) === val
      )
        push("date", val);
    }
    for (const [k, label] of [
      ["netAmount", /(?:不含税金额|税前金额|NetAmount)/i],
      ["taxAmount", /(?:税额|TaxAmount)/i],
    ]) {
      const m = compact.match(
        new RegExp(
          label.source + "[:：]?[¥￥]?(\\d[\\d,]*\\.\\d{2})(?!\\d)",
          "i",
        ),
      );
      if (m) {
        const n = Number(m[1].replaceAll(",", ""));
        if (n >= 0 && n <= 1000000) push(k, n.toFixed(2));
      }
    }
  }
  const result = {
    number: base.invoice || "",
    amount: base.amount || "",
    code: "",
    date: "",
    buyerName: "",
    buyerTaxId: "",
    sellerName: "",
    sellerTaxId: "",
    netAmount: "",
    taxAmount: "",
  };
  for (const [key, values] of Object.entries(hits)) {
    const unique = [...new Set(values)];
    if (unique.length === 1) result[key] = unique[0];
  }
  return result;
}
