import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, mailMessages, titleCase } from './mail.mjs';

const smtp = sent => ({ from: { name: 'Family Hub', address: 'studio@example.test' }, transport: { sendMail: async message => { sent.push(message); } } });

test('subjects are in title case and keep the deployment name as written', () => {
  const messages = mailMessages('the Lab');
  assert.equal(messages.invite({ name: 'Ann', link: 'https://x.test/a', hours: 72 }).subject, 'You’re Invited to the Lab');
  assert.equal(messages.recovery({ name: 'Ann', link: 'https://x.test/a', minutes: 30 }).subject, 'Reset Your the Lab Password');
  assert.equal(messages.code({ name: 'Ann', code: '123456', minutes: 10 }).subject, 'Your the Lab Sign-In Code: 123456');
  assert.equal(messages.alert({ name: 'Ann', title: 'A backup code was used', event: 'x' }).subject, 'Security Alert: A Backup Code Was Used');
  assert.equal(titleCase('single sign-on linked to the account'), 'Single Sign-On Linked to the Account');
});

test('emails are HTML with a button, the link written out, the logo inside, and a plain-text copy', async () => {
  const sent = [];
  const mailer = createMailer(smtp(sent), () => 'Family Hub', async () => '#203040');
  const link = 'https://hub.example.test/studio/auth/recover#token&more';
  await mailer.send({ to: 'ann@example.test', ...mailMessages('Family Hub').recovery({ name: '<Ann & "Bo">', link, minutes: 30 }) });
  const [message] = sent;
  assert.match(message.text, /https:\/\/hub\.example\.test\/studio\/auth\/recover#token&more/);
  assert.match(message.html, /<a href="https:\/\/hub\.example\.test\/studio\/auth\/recover#token&amp;more"[^>]*>Choose a new password<\/a>/);
  assert.match(message.html, /background:#203040/);
  assert.match(message.html, /color:#ffffff;text-decoration:none/, 'light text on a dark accent');
  assert.match(message.html, /Hello &lt;Ann &amp; &quot;Bo&quot;&gt;,/);
  assert.doesNotMatch(message.html, /<Ann/);
  assert.equal(message.attachments[0].cid, 'studio-logo@homepage-studio');
  assert.match(message.html, /src="cid:studio-logo@homepage-studio"/);
});

test('a sign-in code shows as a code, and an unreadable accent falls back to the default', async () => {
  const sent = [];
  const mailer = createMailer(smtp(sent), () => 'Family Hub', async () => { throw new Error('unreadable'); });
  await mailer.send({ to: 'ann@example.test', ...mailMessages('Family Hub').code({ name: 'Ann', code: '654321', minutes: 10 }) });
  assert.match(sent[0].html, />654321<\/td>/);
  assert.doesNotMatch(sent[0].html, /<a href/);
  assert.match(sent[0].text, /code is 654321/);
});
