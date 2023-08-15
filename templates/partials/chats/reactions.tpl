{{{ if config.enableMessageReactions }}}
<div class="reactions {{{ if ./deleted}}}hidden{{{ end }}}" component="message/reactions" data-mid="{./mid}">
	{{{ each ./reactions }}}
	<!-- IMPORT partials/chats/reaction.tpl -->
	{{{ end }}}
</div>
{{{ end }}}