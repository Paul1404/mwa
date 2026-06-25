import { describe, expect, it } from "vitest";
import {
  fqdn,
  isDomainkeyRecord,
  isSesDkimRecord,
  normalizeRecord,
  normalizeTxtValue,
  sameRecord,
} from "./dns-utils.server";
import type { DnsRecord } from "./providers/types";

describe("DNS utilities", () => {
  it("normalizes record names and TXT chunks", () => {
    expect(fqdn("Example.COM")).toBe("example.com.");
    expect(normalizeTxtValue('"v=DKIM1;p=abc" "def"')).toBe("v=DKIM1;p=abcdef");
    expect(
      normalizeRecord({
        name: "DKIM._domainkey.Example.COM",
        type: "TXT",
        values: ['"v=DKIM1;p=abc" "def"'],
      }).values,
    ).toEqual(["v=DKIM1;p=abcdef"]);
  });

  it("compares MX and TXT records without depending on value order", () => {
    const a: DnsRecord = {
      name: "example.com",
      type: "TXT",
      values: ["google-site-verification=x", "v=spf1 include:pdcd.net ~all"],
    };
    const b: DnsRecord = {
      name: "example.com.",
      type: "TXT",
      values: ['"v=spf1 include:pdcd.net ~all"', '"google-site-verification=x"'],
    };
    expect(sameRecord(a, b)).toBe(true);
  });

  it("classifies SES and non-SES DKIM records", () => {
    const ses: DnsRecord = {
      name: "abc._domainkey.example.com",
      type: "CNAME",
      values: ["abc.dkim.amazonses.com"],
    };
    const mailcow: DnsRecord = {
      name: "dkim._domainkey.example.com",
      type: "TXT",
      values: ["v=DKIM1;p=abc"],
    };
    expect(isDomainkeyRecord(ses, "example.com")).toBe(true);
    expect(isSesDkimRecord(ses)).toBe(true);
    expect(isDomainkeyRecord(mailcow, "example.com")).toBe(true);
    expect(isSesDkimRecord(mailcow)).toBe(false);
  });
});
