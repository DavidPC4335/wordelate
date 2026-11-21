import { useEffect } from "preact/hooks";
import { PageFrame } from "./account-page.js";

const UPDATED = "November 21, 2026";

/** The privacy policy. Plain text so it can be edited without touching anything else. */
export function PrivacyPage() {
  useEffect(() => {
    const before = document.title;
    document.title = "Privacy Policy — Wordelate";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <PageFrame title="Privacy Policy">
      <article class="legal">
        <p class="legal-meta">Last updated {UPDATED}</p>

        <section>
          <h2>1. Who we are</h2>
          <p>
            Wordelate (“Wordelate”, “we”, “us”) is a daily word puzzle available at wordelate.com and related addresses
            (the “Service”). This policy describes what information the Service handles and the rights we hold in it.
            By using the Service, you agree to this policy.
          </p>
        </section>

        <section>
          <h2>2. Information the Service handles</h2>
          <ul>
            <li>
              <strong>Google account information.</strong> If you choose “Log in with Google”, we receive your Google
              account ID, name, email address, and the web address of your profile picture. We keep that address only. We never download or store the picture itself.
            </li>
            <li>
              <strong>Game data.</strong> Your scores, moves, points, streaks, friend connections, and the display name
              you choose for a leaderboard (your username by default), and, unless you turn it off, the address of your profile picture.
            </li>
            <li>
              <strong>Device data.</strong> An anonymous player ID and your game progress stored in your browser, and a
              sign-in cookie if you log in.
            </li>
            <li>
              <strong>Technical data.</strong> Your IP address and request details, used to run, secure, and rate limit
              the Service.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. Our rights in the information</h2>
          <p>
            To the fullest extent permitted by applicable law, you grant Wordelate and its operator a worldwide,
            perpetual, irrevocable, non-exclusive, royalty-free, fully paid, transferable, and sublicensable right and
            license to collect, store, copy, reproduce, process, analyze, combine, modify, publish, display, disclose,
            share, license, sell, and otherwise use the information described in this policy, for any lawful purpose
            and in any manner we choose, with or without notice to you.
          </p>
          <p>
            We may also transfer the information to a successor in connection with a merger, acquisition, financing,
            or sale of all or part of the Service, and to service providers who help us run it.
          </p>
        </section>

        <section>
          <h2>4. Google user data</h2>
          <p>
            Wordelate’s use and transfer of information received from Google APIs will adhere to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">
              Google API Services User Data Policy
            </a>
            , including its Limited Use requirements. Where that policy is stricter than section 3, it controls for
            information we receive from Google.
          </p>
        </section>

        <section>
          <h2>5. Where it is kept and for how long</h2>
          <p>
            Account data is stored with Cloudflare, and a copy is backed up weekly. We keep information for as long as
            we choose. You can delete your account from the account page; this removes it from the live service, but
            earlier backups may remain for a period of time.
          </p>
        </section>

        <section>
          <h2>6. Other people can see some of it</h2>
          <p>
            Your username, picture, points, streak, and recent scores are visible to the friends you connect with.
            Any name you add to a leaderboard, and your profile picture unless you turn it off, is visible to everyone who views that leaderboard.
          </p>
        </section>

        <section>
          <h2>7. Your choices and legal rights</h2>
          <p>
            You can stop using the Service, log out, or delete your account at any time. Nothing in this policy limits
            any right you have under law that cannot be waived by agreement, including data protection and privacy
            laws that apply where you live.
          </p>
        </section>

        <section>
          <h2>8. Children</h2>
          <p>The Service is not directed to children under 13, and we do not knowingly collect their information.</p>
        </section>

        <section>
          <h2>9. Changes</h2>
          <p>
            We may change this policy at any time by posting a new version here. Continuing to use the Service after a
            change means you accept it.
          </p>
        </section>

        <section>
          <h2>10. No warranty</h2>
          <p>
            The Service and this policy are provided “as is”. To the fullest extent permitted by law, Wordelate
            disclaims all warranties and liability arising from the handling of information.
          </p>
        </section>
      </article>
    </PageFrame>
  );
}
