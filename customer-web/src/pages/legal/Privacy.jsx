/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React from "react";
import { Grievance } from "./shared";

export default function Privacy({ L }) {
  return (
    <>
      <h2 id="privacy">Privacy Policy</h2>
      <h3>3.1 Roles under the Digital Personal Data Protection Act, 2023</h3>
      <p>
        For personal data collected through this website, the Restaurant acts as the <strong>Data Fiduciary</strong> under
        the Digital Personal Data Protection Act, 2023 ("DPDP Act"), as it determines the purpose and means of collecting
        Customer data (namely, to fulfil food orders and operate its business). KnotKitchen acts as a{" "}
        <strong>Data Processor</strong>, processing such data solely on the Restaurant's documented instructions, strictly
        to operate the website's technical infrastructure, and does not use Customer data for any independent purpose of
        its own, including cross-restaurant marketing, without separate, specific consent.
      </p>
      <h3>3.2 What Personal Data We Collect</h3>
      <div className="tbl">
        <table>
          <tbody>
            <tr>
              <th>Category</th>
              <th>Examples</th>
              <th>Collected by / stored via</th>
            </tr>
            <tr>
              <td>Identity &amp; contact data</td>
              <td>Name, phone number, email address</td>
              <td>Website (Restaurant's Data Fiduciary instance, hosted by KnotKitchen)</td>
            </tr>
            <tr>
              <td>Location data</td>
              <td>Delivery address, and (if permitted) live location for delivery tracking</td>
              <td>Website / device permissions</td>
            </tr>
            <tr>
              <td>Order data</td>
              <td>Order history, item preferences, special instructions, ratings/reviews</td>
              <td>Website</td>
            </tr>
            <tr>
              <td>Transaction data</td>
              <td>Order value, payment status, transaction reference ID</td>
              <td>Website (status only) &amp; Payment Gateway (full transaction)</td>
            </tr>
            <tr>
              <td>Payment instrument data</td>
              <td>Card number, UPI credentials, wallet login</td>
              <td>Payment Gateway only. Never received or stored by this website or KnotKitchen</td>
            </tr>
            <tr>
              <td>Technical/usage data</td>
              <td>IP address, browser/device type, cookies, page interaction logs</td>
              <td>Website infrastructure, for security and analytics</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>3.3 Cookies and Tracking Technologies</h3>
      <p>
        This website uses cookies and similar technologies to remember cart contents, keep Customers logged in, and
        understand site usage through aggregate analytics. Customers may control cookie preferences through their browser
        settings; disabling essential cookies may affect the ability to place Orders.
      </p>
      <h3>3.4 Purpose of Collection and Lawful Basis / Consent</h3>
      <p>
        Personal data is collected and processed only for: processing and delivering Orders; enabling payment via the
        Payment Gateway; customer support and complaint resolution; legally mandated record-keeping (for example, under GST
        law or the Consumer Protection Act, 2019); fraud prevention and website security; and, only where the Customer has
        separately and affirmatively opted in, promotional communication from the Restaurant. Consent for optional purposes
        is captured at the point of account creation or order placement and may be withdrawn at any time without affecting
        the lawfulness of processing already carried out, by contacting the Grievance Officer named below.
      </p>
      <h3>3.5 Data Sharing and Disclosure</h3>
      <p>
        Personal data is shared only with the following categories of recipient, and never sold to unrelated third parties
        for their own marketing purposes:
      </p>
      <ol className="legal">
        <li>The Restaurant, as Data Fiduciary, for order fulfilment and customer relationship purposes;</li>
        <li>The Payment Gateway, strictly to the extent necessary to process and confirm payment;</li>
        <li>
          The Delivery Partner (Restaurant's own staff, or KnotKitchen's delivery service where opted in), strictly to the
          extent necessary to deliver the Order (name, phone number, and delivery address only);
        </li>
        <li>KnotKitchen, strictly in its capacity as Data Processor operating the underlying website infrastructure; and</li>
        <li>
          Government or regulatory authorities, where disclosure is required under applicable law, a valid legal process,
          or to protect the rights, property, or safety of the Restaurant, KnotKitchen, or any Customer.
        </li>
      </ol>
      <h3>3.6 Children's Data</h3>
      <p>
        This website is not directed at, and does not knowingly collect personal data from, individuals below 18 years of
        age, consistent with the additional protections for children's data under the DPDP Act, 2023. If a parent or
        guardian believes a child has provided personal data through this website, they may contact the Grievance Officer
        for deletion.
      </p>
      <h3>3.7 Data Retention</h3>
      <p>
        Personal data is retained only for as long as necessary to fulfil the purposes described above, or as required
        under applicable law (for example, tax record-keeping periods under GST law, or the limitation period for consumer
        disputes under the Consumer Protection Act, 2019), after which it is securely deleted or anonymised.
      </p>
      <h3>3.8 Security Measures and Breach Notification</h3>
      <p>
        KnotKitchen implements reasonable technical and organisational security measures for data stored on the website's
        infrastructure, including encryption in transit, access controls, and regular security review, consistent with
        Section 43A of the IT Act, 2000 and the IT (Reasonable Security Practices) Rules, 2011. In the event of a personal
        data breach affecting the website's infrastructure, KnotKitchen will notify the Restaurant without undue delay; the
        Restaurant, as Data Fiduciary, is responsible for notifying affected Customers and the Data Protection Board of
        India as required under the DPDP Act, 2023, with KnotKitchen providing reasonable technical assistance to
        investigate and remediate the breach.
      </p>
      <h3>3.9 Your Rights as a Data Principal</h3>
      <p>
        Subject to the DPDP Act, 2023, Customers may: request a summary of the personal data held and the processing
        carried out; request correction or completion of inaccurate or incomplete data; request erasure of personal data no
        longer necessary for the purposes collected; withdraw previously given consent; and nominate another individual to
        exercise these rights on their behalf in the event of death or incapacity. Requests should be directed to the
        Restaurant's Grievance Officer named below. Requests relating solely to the website's security or hosting
        infrastructure may be directed to KnotKitchen's designated contact.
      </p>
      <h3>3.10 International Data Transfer</h3>
      <p>
        Where the website's hosting or backup infrastructure is located outside India, data may be transferred and stored
        accordingly, subject to any restrictions notified by the Central Government under the DPDP Act, 2023. KnotKitchen
        will ensure any such transfer is accompanied by reasonable safeguards.
      </p>
      <Grievance L={L} />
    </>
  );
}
