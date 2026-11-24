use crate::{Client, Target};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::collections::HashSet;
/// Dispatch a chat command. Returns true only after an authorized !shutdown.
/// Authorize against server-supplied registered IDs, never names from message text.
pub async fn handle(client: &Client, event: &Value, admins: &HashSet<u32>) -> Result<bool> {
    if event["event"] != "text" || event["self"] == true {
        return Ok(false);
    }
    let Some(actor) = event["actor"].as_u64().and_then(|n| u32::try_from(n).ok()) else {
        return Ok(false);
    };
    let Some(html) = event["html"].as_str() else {
        return Ok(false);
    };
    // Mumble text is HTML: a channel named "A & B" arrives as "A &amp; B".
    let text = plain(html);
    let text = text.trim();
    let (command, argument) = text
        .split_once(char::is_whitespace)
        .map(|(c, a)| (c, a.trim()))
        .unwrap_or((text, ""));
    if ![
        "!help",
        "!ping",
        "!status",
        "!whoami",
        "!join",
        "!mute",
        "!deaf",
        "!shutdown",
    ]
    .contains(&command)
    {
        return Ok(false);
    }
    let user = client.state().users.get(&actor).cloned();
    let user_id = user.and_then(|u| u.user_id);
    let admin = user_id.is_some_and(|id| admins.contains(&id));
    if ["!join", "!mute", "!deaf", "!shutdown"].contains(&command) && !admin {
        client.send_text("This command requires an allowlisted registered user ID. Use !whoami to find yours.",Some(Target::Id(actor)),None).await?;
        return Ok(false);
    }
    let response=async{Ok::<String,anyhow::Error>(match command{
        "!help"=>"Commands: !help, !ping, !status, !whoami. Admin: !join /Channel, !mute on|off, !deaf on|off, !shutdown.".into(),
        "!ping"=>"pong".into(),
        "!whoami"=>format!("Your session ID: {actor}. Registered user ID: {}.",user_id.map(|n|n.to_string()).unwrap_or_else(||"none (register your user on this server first)".into())),
        "!status"=>{let state=client.state();format!("Connected as {}; channel {}; {} users; UDP {}.",state.own().map(|u|u.name.as_str()).unwrap_or("unknown"),state.path(state.own().map(|u|u.channel_id).unwrap_or(0)),state.users.len(),state.udp)},
        "!join"=>{if argument.is_empty(){anyhow::bail!("Usage: !join /Channel");}client.join(Target::Name(argument.into())).await?;format!("Joined {argument}.")},
        "!mute"|"!deaf"=>{let enabled=match argument{"on"=>true,"off"=>false,_=>anyhow::bail!("Usage: {command} on|off")};let(op,key)=if command=="!mute"{("mute","muted")}else{("deaf","deafened")};let mut value=json!({"op":op});value[key]=enabled.into();client.command(value).await?;client.flush().await?;format!("{} {argument} submitted.",&command[1..])},
        "!shutdown"=>"Shutting down.".into(),_=>unreachable!()
    })}.await;
    let success = response.is_ok();
    let reply = response.unwrap_or_else(|e| format!("Command failed: {e}"));
    client
        .send_text(&reply, Some(Target::Id(actor)), None)
        .await
        .context("Sending bot reply")?;
    Ok(command == "!shutdown" && success)
}

/// The text of a Mumble HTML message: tags removed, `<br>` as a space, entities decoded.
pub fn plain(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        text.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('>') else {
            rest = "";
            break;
        };
        let tag = rest[start + 1..start + end].trim().to_ascii_lowercase();
        if tag.starts_with("br") || tag.starts_with("/p") {
            text.push(' ');
        }
        rest = &rest[start + end + 1..];
    }
    text.push_str(rest);
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let decoded = after.find(';').filter(|n| *n <= 10).and_then(|n| {
            let name = &after[..n];
            let c = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .or_else(|| name.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            }?;
            Some((c, n))
        });
        match decoded {
            Some((c, n)) => {
                out.push(c);
                rest = &after[n + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::plain;
    #[test]
    fn commands_are_read_from_plain_text() {
        assert_eq!(plain("!join /Music &amp; Talk"), "!join /Music & Talk");
        assert_eq!(plain("!join <b>/Caf&#233;</b>"), "!join /Café");
        assert_eq!(plain("!help<br/>"), "!help ");
        assert_eq!(plain("a &unknown; &#x41; & b"), "a &unknown; A & b");
    }
}
