// The firm's settings (record "firm"), with defaults until someone saves them.
import { get } from "./store.js";

export const DEFAULT_FIRM = {
  name: "KNOTKITCHEN",
  address: "J-183 Baishnabghata, Patuli Township, P.O. Panchasayar, P.S. Patuli, Kolkata 700094",
  state: "West Bengal",
  pan: "",
  gstin: "",
  gstFrom: "",
  qrmp: true,
  prefix: "KK",
  sac: "998314",
  gstRate: 18,
  bankName: "",
  bankAccount: "",
  bankIfsc: "",
  bankBranch: "",
  email: "",
  phone: "",
  partners: [
    { name: "Supratim Karmakar", share: 50 },
    { name: "Tapash Karmakar", share: 50 },
  ],
};

export const firm = () => ({ ...DEFAULT_FIRM, ...(get("firm") || {}) });

export const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export const CATEGORIES = [
  "Software & subscriptions", "Hosting & domain", "Hardware & equipment", "Devices for resale (stock)", "Marketing & ads",
  "Travel & conveyance", "Phone & internet", "Professional fees (CA/legal)", "Registration & govt fees", "Office & stationery",
  "Rent", "Salaries & contractors", "Bank charges", "Food & entertainment", "Other",
];

export const GST_RATES = [0, 5, 12, 18, 28, 40];
export const PAY_MODES = ["UPI", "Bank transfer", "Cash", "Card", "Cheque"];
