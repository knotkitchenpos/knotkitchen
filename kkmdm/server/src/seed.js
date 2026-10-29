/**
 * bootstrap(): idempotent first-boot setup, run on every start.
 * `npm run seed`: also adds the local demo store (Demo Pizza Kitchen, 893146).
 */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const config = require("./config");
const { Company, Role, AdminUser, Policy, PolicyAssignment, AlertRule, Store } = require("./models");
const { ROLES, permissionsFor } = require("./lib/rbac");
const { randomToken } = require("./lib/crypto");

async function bootstrap() {
  let company = await Company.findOne().sort({ createdAt: 1 });
  if (!company) company = await Company.create({ name: "KnotKitchen", slug: "knotkitchen" });

  for (const [key, r] of Object.entries(ROLES)) {
    await Role.updateOne({ key }, { $set: { name: r.name, permissions: permissionsFor(key) } }, { upsert: true });
  }

  if (!(await AdminUser.exists({}))) {
    let password = config.superAdminPassword;
    if (!password) {
      if (config.isProduction) throw new Error("SUPERADMIN_PASSWORD must be set for the first boot");
      password = `Kk-${randomToken(9)}9a`;
      fs.mkdirSync(config.storageDir, { recursive: true });
      const file = path.join(config.storageDir, "initial-admin.txt");
      fs.writeFileSync(file, `email: ${config.superAdminEmail}\npassword: ${password}\n`);
      console.log(`[kkmdm] created Super Admin ${config.superAdminEmail}; password written to ${file}`);
    }
    await AdminUser.create({
      email: config.superAdminEmail, name: "Super Admin", role: "super_admin", companyId: company._id,
      passwordHash: await bcrypt.hash(password, 12),
    });
  }

  if (!(await Policy.exists({}))) {
    const standard = await Policy.create({
      companyId: company._id,
      name: "Standard POS kiosk",
      description: "Company default: KnotKitchen POS locked as a single-app kiosk.",
      settings: {},
    });
    await PolicyAssignment.create({ policyId: standard._id, scope: "company", targetId: company._id });
    await Policy.create({
      companyId: company._id,
      name: "Test tablet (ADB allowed)",
      description: "Same kiosk, but USB debugging stays on so a test tablet can be managed and released over ADB.",
      settings: { restrictions: { blockDebugging: false, hidePlayStore: false } },
    });
  }

  if (!(await AlertRule.exists({}))) {
    await AlertRule.insertMany([
      { companyId: company._id, type: "offline", threshold: 15, businessHoursOnly: true },
      { companyId: company._id, type: "kiosk_exited" },
      { companyId: company._id, type: "crash_loop", threshold: 5 },
      { companyId: company._id, type: "low_storage", threshold: 500 },
      { companyId: company._id, type: "low_battery", threshold: 15 },
      { companyId: company._id, type: "policy_noncompliant" },
    ]);
  }
  return company;
}

async function seedDemo() {
  await mongoose.connect(config.mongoUri);
  const company = await bootstrap();
  await Store.updateOne(
    { kkStoreId: "893146" },
    { $setOnInsert: { companyId: company._id, name: "Demo Pizza Kitchen" } },
    { upsert: true },
  );
  console.log("[kkmdm] seeded: company, roles, policies, alert rules, demo store 893146");
  await mongoose.disconnect();
}

if (require.main === module) {
  seedDemo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { bootstrap };
