<?php
/**
 * Daily Diversions — send-mail.php
 *
 * Stub file — configure this before going live.
 *
 * This script receives a JSON POST from the share form in app.js
 * and sends an email to the recipient.
 *
 * ============================================================
 * TO CONFIGURE:
 *
 * 1. Set $allowed_origins to your actual domain(s).
 * 2. Choose a sending method:
 *    a) PHP mail() — works on most shared hosts, but often
 *       flagged as spam. Change $use_smtp to false.
 *    b) PHPMailer + SMTP — recommended. Install PHPMailer via
 *       Composer (composer require phpmailer/phpmailer), then
 *       fill in the SMTP credentials below.
 * 3. Set $from_email / $from_name to your sending address.
 * ============================================================
 */

// --- CORS: restrict to your domain in production -------------
$allowed_origins = [
    'http://localhost',
    'http://localhost:8080',
    'https://earthoffice.net',   // <-- add your live domain here
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins, true)) {
    header("Access-Control-Allow-Origin: $origin");
}
header('Content-Type: application/json; charset=utf-8');

// Handle pre-flight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    exit;
}

// --- Only allow POST -----------------------------------------
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
    exit;
}

// --- Parse JSON body ----------------------------------------
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid request body.']);
    exit;
}

// --- Validate inputs ----------------------------------------
$recipient_email  = filter_var(trim($data['recipientEmail']  ?? ''), FILTER_VALIDATE_EMAIL);
$personal_message = strip_tags(trim($data['personalMessage'] ?? ''));
$content_title    = strip_tags(trim($data['contentTitle']    ?? ''));
$content_category = strip_tags(trim($data['contentCategory'] ?? ''));
$content_date     = strip_tags(trim($data['contentDate']     ?? ''));
$share_url        = filter_var(trim($data['shareUrl']        ?? ''), FILTER_SANITIZE_URL);

if (!$recipient_email) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid recipient email is required.']);
    exit;
}

// --- Sender configuration -----------------------------------
// TODO: Replace with your real sending address
$from_email = 'patb@earthoffice.net';
$from_name  = 'Daily Diversions';

// --- Build the email ----------------------------------------
$subject = "Daily Diversions: \"$content_title\" ($content_category)";

$body_text = "Someone shared a Daily Diversion with you!\n\n";
if ($personal_message) {
    $body_text .= "They said: \"$personal_message\"\n\n";
}
$body_text .= "Today's pick ($content_date): $content_title\n";
$body_text .= "Category: $content_category\n\n";
$body_text .= "View it here: $share_url\n\n";
$body_text .= "---\nDaily Diversions — a new discovery every day.\n";

// Simple HTML version
$body_html  = '<html><body style="font-family:sans-serif;max-width:560px;margin:auto;color:#222">';
$body_html .= '<h2 style="color:#3b5e8c">Someone shared a Daily Diversion with you!</h2>';
if ($personal_message) {
    $msg_escaped = htmlspecialchars($personal_message, ENT_QUOTES, 'UTF-8');
    $body_html .= "<blockquote style='border-left:3px solid #c0793a;margin-left:0;padding-left:1em;color:#555'>&ldquo;$msg_escaped&rdquo;</blockquote>";
}
$body_html .= '<p><strong>Today\'s pick (' . htmlspecialchars($content_date, ENT_QUOTES, 'UTF-8') . '):</strong><br>';
$body_html .= htmlspecialchars($content_title, ENT_QUOTES, 'UTF-8') . '<br>';
$body_html .= '<em>' . htmlspecialchars($content_category, ENT_QUOTES, 'UTF-8') . '</em></p>';
$url_escaped = htmlspecialchars($share_url, ENT_QUOTES, 'UTF-8');
$body_html .= "<p><a href='$url_escaped' style='background:#3b5e8c;color:#fff;padding:0.6em 1.4em;border-radius:999px;text-decoration:none;display:inline-block'>View today's content &rarr;</a></p>";
$body_html .= '<hr style="border:none;border-top:1px solid #ddd;margin-top:2em">';
$body_html .= '<p style="font-size:0.8em;color:#999">Daily Diversions &mdash; a new discovery every day.</p>';
$body_html .= '</body></html>';

// ============================================================
// SENDING METHOD A: PHP mail() — quick setup, often spam-flagged
// ============================================================
// Uncomment the block below if you want to use PHP's built-in
// mail() function (no extra library required).
//
 $headers  = "From: $from_name <$from_email>\r\n";
 $headers .= "Reply-To: $from_email\r\n";
 $headers .= "MIME-Version: 1.0\r\n";
 $headers .= "Content-Type: text/html; charset=UTF-8\r\n";

 $sent = mail($recipient_email, $subject, $body_html, $headers);

 if ($sent) {
     echo json_encode(['success' => true, 'message' => 'Email sent.']);
 } else {
     http_response_code(500);
     echo json_encode(['success' => false, 'message' => 'mail() failed.']);
 }
 exit;

// ============================================================
// SENDING METHOD B: PHPMailer + SMTP (recommended)
// ============================================================
// 1. composer require phpmailer/phpmailer
// 2. Fill in credentials below.
// 3. Uncomment this entire block.
//
// require 'vendor/autoload.php';
// use PHPMailer\PHPMailer\PHPMailer;
// use PHPMailer\PHPMailer\Exception;
//
// $mail = new PHPMailer(true);
// try {
//     $mail->isSMTP();
//     $mail->Host       = 'smtp.yourmailprovider.com';  // e.g. smtp.gmail.com
//     $mail->SMTPAuth   = true;
//     $mail->Username   = 'your-smtp-username';
//     $mail->Password   = 'your-smtp-password';
//     $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
//     $mail->Port       = 587;
//
//     $mail->setFrom($from_email, $from_name);
//     $mail->addAddress($recipient_email);
//     $mail->Subject  = $subject;
//     $mail->isHTML(true);
//     $mail->Body     = $body_html;
//     $mail->AltBody  = $body_text;
//
//     $mail->send();
//     echo json_encode(['success' => true, 'message' => 'Email sent.']);
// } catch (Exception $e) {
//     http_response_code(500);
//     echo json_encode(['success' => false, 'message' => "Mail error: {$mail->ErrorInfo}"]);
// }
// exit;

// ============================================================
// STUB RESPONSE — remove once a sending method is uncommented
// ============================================================
//http_response_code(501);
//echo json_encode([
//    'success' => false,
//    'message' => 'Mail sending is not yet configured. See send-mail.php for setup instructions.',
//]);
