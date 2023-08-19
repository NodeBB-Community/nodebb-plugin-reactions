{{{ if config.enableMessageReactions }}}
<div class="reactions {{{ if messages.deleted}}}hidden{{{ end }}}" component="message/reactions" data-mid="{messages.mid}">
	{{{ each messages.reactions }}}
	<!-- IMPORT partials/chats/reaction.tpl -->
	{{{ end }}}
</div>
{{{ end }}}