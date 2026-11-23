/**
 * The built-in birthday wishes a server's own list starts with, and the ones
 * sent when that list is empty. The array index is what the legacy
 * BirthdayWishUsage rows store, so existing entries never move or change
 * order; new wishes are appended.
 *
 * Every wish contains the `${name}` token, replaced by a mention of the
 * celebrant. A wish may contain it more than once.
 */
export const BIRTHDAY_WISHES: readonly string[] = [
  '${name} thượng thọ vui vẻ! Tuổi mới ăn no chóng lớn, tiền bạc đầy nhà và gà thì đầy chuồng nha!',
  'Chúc mừng sinh nhật ${name}! Chúc ${name} nhan sắc "quyết liệt" thăng hoa, tiền tài ào ào thăng tiến và tình yêu "tưng bừng" bùng nổ nhé!',
  'Chúc ${name} luôn luôn “vui vẻ, tươi trẻ, mạnh khoẻ, tính tình mát mẻ, cuộc đời suôn sẻ” và luôn luôn “tươi cười, yêu đời, ngời ngời sức sống”',
  'Tin nhắn này không có chất béo, không cholesterol, và không chứa chất gây nghiện. Nó chỉ có nhiều đường vì những điều ngọt ngào dành tới ${name}. Chúc ${name} sinh nhật vui vẻ và ngập tràn tiếng cười.',
  'Xin chúc ${name} có một sức khỏe tươi mới, thành công luôn luôn tới, về sắc diện thì ai nhìn cũng phải chới với... Happy Birthday!',
  'Với cái tuổi thật đẹp này, xin chúc ${name} có một sức khỏe tươi mới, thành công luôn luôn tới, về sắc diện thì ai nhìn cũng phải chới với, hihi. Happy Birthday!',
  'Tặng bạn niềm vui để bạn ngọt ngào, tặng bạn nụ cười để bạn rạng rỡ, tặng bạn nhiều điều tốt lành để bạn! Chúc ${name} sinh nhật vui vẻ!',
  'Chúc mừng sinh nhật ${name}! Chúc ${name} có một ngày sinh nhật thật vui vẻ, thật ấm áp và thật ý nghĩa bên gia đình và bạn bè!',
  'Chúc bạn tuổi mới sẽ luôn hạnh phúc và khỏe mạnh. Mong rằng dù có khó khăn hay giông bão, bạn cũng sẽ vững vàng tiến lên phía trước. Cảm ơn bạn vì đã đồng hành cùng chúng mình. Những tháng ngày sắp tới, mong bạn hay luôn vui vẻ và cố gắng hết mình nhé. Chúc ${name} sinh nhật vui vẻ.',
  'Mong bạn luôn vui, mong bạn luôn khỏe, mong bạn hãy luôn tận hưởng từng khoảnh khắc xinh đẹp trong cuộc đời này. Tuổi mới hãy không ngừng vững vàng tiến về phía trước nhé. Bạn đối với chúng mình là một người tuyệt vời lắm đó. Chúc ${name} sinh nhật vui vẻ nhé!',
  'Chúc bạn vượt qua thử thách, đạt được ước mơ. Chúc bạn không phải mệt mỏi, không phải đau buồn. Mong bạn yêu thương và trân quý mọi người, cũng mong rằng bạn được thật nhiều người trân quý và yêu thương. Chúc bạn có một tuổi mới thật vui vẻ, thật an lành. Chúc mừng sinh nhật ${name}!',
  'Chúc bạn tuổi mới vẫn sẽ giữ trên môi nụ cười rạng rỡ ấy. Mong rằng bạn sẽ vẫn tiếp tục cố gắng, tiếp tục kiên trì theo đuổi ước mơ. Chúng mình cảm ơn bạn vì đã đồng hành với SAB trong suốt thời gian qua. Chúc bạn luôn hạnh phúc và khỏe mạnh nhé. Sinh nhật vui vẻ ${name}!',
  'SAB xin gửi chúc mừng sinh nhật nồng nhiệt nhất đến ${name} Chúc bạn tuổi mới tràn đầy niềm vui, sức khỏe dồi dào và tiếp tục cống hiến những nội dung sáng tạo, độc đáo cho SAB. Là một SABie đầy tài năng và tâm huyết. Với khả năng sáng tạo nội dung "chất như nước cất" của bạn, mong rằng bạn sẽ tiếp tục đóng góp cho SAB những sản phẩm thật chất lượng. Tin rằng với sự sáng tạo và nỗ lực của bạn, bạn sẽ còn gặt hái được nhiều thành công nữa trong tương lai. Chúc bạn sẽ luôn mạnh khỏe để bước tiếp trên đoạn hành trình thật dài phía trước, và chinh phục được những ước mơ của bản thân.',
  'SAB xin gửi đến ${name} một lời chúc "Siu to khổng lồ". Chúc bạn thật nhiều sức khỏe để tiếp tục “cân” mọi chương trình. Sẽ luôn có thật nhiều niềm vui trong cuộc sống. Và cuối cùng là luôn giữ được ngọn lửa đam mê và tiếp tục cháy hết mình trong mọi việc. Cảm ơn các bạn vì đã luôn đồng hành cùng SAB trong suốt thời gian qua. Với sự cống hiến và nhiệt tình của mình, các bạn đã góp phần tạo nên những chương trình, hoạt động sôi nổi và ý nghĩa cho tổ chức. ',
  'Chúc bạn tuổi mới sẽ luôn hạnh phúc và khỏe mạnh. Mong rằng dù có khó khăn hay giông bão, bạn cũng sẽ vững vàng tiến lên phía trước. Cảm ơn bạn vì đã đồng hành cùng chúng mình. Những tháng ngày sắp tới, mong bạn hay luôn vui vẻ và cố gắng hết mình nhé. Chúc ${name} sinh nhật vui vẻ.',
  'Mong bạn luôn vui, mong bạn luôn khỏe, mong bạn hãy luôn tận hưởng từng khoảnh khắc xinh đẹp trong cuộc đời này. Tuổi mới hãy không ngừng vững vàng tiến về phía trước nhé. Bạn đối với chúng mình là một người tuyệt vời lắm đó. Chúc ${name} sinh nhật vui vẻ nhé!',
  'Chúc bạn vượt qua thử thách, đạt được ước mơ. Chúc bạn không phải mệt mỏi, không phải đau buồn. Mong bạn yêu thương và trân quý mọi người, cũng mong rằng bạn được thật nhiều người trân quý và yêu thương. Chúc bạn có một tuổi mới thật vui vẻ, thật an lành. Chúc mừng sinh nhật ${name}.',
  'Chúc bạn tuổi mới vẫn sẽ giữ trên môi nụ cười rạng rỡ ấy. Mong rằng bạn sẽ vẫn tiếp tục cố gắng, tiếp tục kiên trì theo đuổi ước mơ. Chúng mình cảm ơn bạn vì đã đồng hành với SAB trong suốt thời gian qua. Chúc bạn luôn hạnh phúc và khỏe mạnh nhé. Sinh nhật vui vẻ ${name}!',
  'SAB xin gửi chúc mừng sinh nhật nồng nhiệt nhất đến ${name} Chúc bạn tuổi mới tràn đầy niềm vui, sức khỏe dồi dào và tiếp tục cống hiến những nội dung sáng tạo, độc đáo cho SAB. Là một SABie đầy tài năng và tâm huyết. Với khả năng sáng tạo nội dung "chất như nước cất" của bạn, mong rằng bạn sẽ tiếp tục đóng góp cho SAB những sản phẩm thật chất lượng. Tin rằng với sự sáng tạo và nỗ lực của bạn, bạn sẽ còn gặt hái được nhiều thành công nữa trong tương lai. Chúc bạn sẽ luôn mạnh khỏe để bước tiếp trên đoạn hành trình thật dài phía trước, và chinh phục được những ước mơ của bản thân.',
  'SAB xin gửi đến ${name} một lời chúc "Siu to khổng lồ". Chúc bạn thật nhiều sức khỏe để tiếp tục "cân" mọi chương trình. Sẽ luôn có thật nhiều niềm vui trong cuộc sống. Và cuối cùng là luôn giữ được ngọn lửa đam mê và tiếp tục cháy hết mình trong mọi việc. Cảm ơn các bạn vì đã luôn đồng hành cùng SAB trong suốt thời gian qua. Với sự cống hiến và nhiệt tình của mình, các bạn đã góp phần tạo nên những chương trình, hoạt động sôi nổi và ý nghĩa cho tổ chức.',
  'Chúc mừng sinh nhật ${name}! Mong tuổi mới của bạn có thật nhiều buổi sáng thức dậy thấy lòng nhẹ tênh, thật nhiều buổi tối đi ngủ thấy mình đã sống một ngày đáng nhớ.',
  'Hôm nay là ngày của ${name}! Cảm ơn bạn đã có mặt trên đời và có mặt ở SAB. Chúc bạn tuổi mới khoẻ mạnh, bình an, và luôn được yêu thương nhiều như cách bạn đã yêu thương mọi người.',
  'Happy birthday ${name}! Chúc bạn một năm mới của riêng mình: học gì cũng hiểu, làm gì cũng thành, gặp ai cũng quý, đi đâu cũng có người chờ.',
  'Một tuổi mới, một trang mới. Chúc ${name} viết nên những chương thật đẹp, có cả niềm vui, có cả thử thách, nhưng chương nào cũng khiến bạn tự hào về chính mình.',
  'Chúc ${name} sinh nhật thật vui! Mong bạn giữ mãi sự tò mò của một người học trò, sự ấm áp của một người bạn và sự kiên trì của một người dám mơ lớn.',
  'SAB chúc ${name} tuổi mới thật rực rỡ! Cảm ơn bạn vì những lần xắn tay áo cùng mọi người, những ý tưởng hay và cả những tiếng cười bạn mang đến cho cả nhà.',
  '${name} ơi, sinh nhật vui vẻ nha! Chúc bạn deadline luôn kịp, điểm số luôn đẹp, ví tiền luôn dày và giấc ngủ luôn đủ, điều cuối cùng là khó nhất đó!',
  'Chúc mừng sinh nhật ${name}! Chúc bạn có đủ nắng để rạng rỡ, đủ mưa để biết trân trọng, đủ gió để bay xa và đủ một mái nhà để luôn muốn quay về.',
  'Gửi ${name} nhân ngày đặc biệt: mong bạn luôn tin rằng mình xứng đáng với những điều tốt đẹp nhất, vì bạn thật sự như vậy. Sinh nhật hạnh phúc nhé!',
  'Thêm một tuổi là thêm một năm trưởng thành. Chúc ${name} luôn đủ dũng cảm để thử điều mới, đủ bình tĩnh để vượt qua vấp ngã và đủ khiêm tốn để không ngừng học hỏi.',
  'Chúc ${name} sinh nhật vui vẻ và một năm mới thật nhiều sức khoẻ! Ăn ngon, ngủ kỹ, cười nhiều, lo ít và lúc nào cũng có người để chia sẻ.',
  'Cả nhà SAB gửi đến ${name} một chiếc bánh kem ảo thật to và vô vàn lời chúc thật! Chúc bạn tuổi mới thành công, vui vẻ, và mãi là một SABie đáng yêu.',
  'Hôm nay vũ trụ có thêm một lý do để ăn mừng, vì đó là sinh nhật của ${name}! Chúc bạn luôn toả sáng theo cách của riêng mình.',
  'Chúc mừng sinh nhật ${name}! Mong mọi ước mơ bạn đang ấp ủ sẽ dần thành hình, và trên con đường đó bạn sẽ không bao giờ phải đi một mình.',
  'Sinh nhật vui vẻ ${name}! Chúc bạn tuổi mới biết yêu thương bản thân nhiều hơn: nghỉ ngơi khi mệt, lên tiếng khi cần và tự thưởng cho mình sau mỗi nỗ lực.',
  'Chúc ${name} có một ngày sinh nhật ngập tràn lời chúc, quà tặng và những cái ôm ấm áp. Cảm ơn bạn vì đã là một phần không thể thiếu của gia đình SAB!',
  'Tuổi mới chúc ${name}: học hành tấn tới, công việc thuận lợi, tình cảm viên mãn, gia đình an vui và mỗi ngày đều có ít nhất một điều khiến bạn mỉm cười.',
  '${name} ơi, chúc mừng bạn đã hoàn thành thêm một vòng quanh Mặt Trời! Chúc vòng tiếp theo thật nhiều trải nghiệm đáng giá và những người bạn tuyệt vời đồng hành.',
  'Chúc mừng sinh nhật ${name}! Mong bạn luôn giữ được ngọn lửa nhiệt huyết, vì chính ngọn lửa ấy đã sưởi ấm và truyền cảm hứng cho rất nhiều người xung quanh bạn.',
  'Nhân ngày sinh nhật, SAB chúc ${name} một năm mới thật "chill": việc gì khó thì có đồng đội gánh cùng, việc gì vui thì có cả nhà hò reo cùng!',
  'Happy birthday ${name}! May this year bring you good health, good friends and great adventures. Chúc bạn tuổi mới thật nhiều niềm vui nhé!',
  'Chúc ${name} tuổi mới như một bản nhạc hay: có những nốt trầm để suy ngẫm, có những nốt cao để bứt phá, và giai điệu nào cũng là của riêng bạn.',
  'Mừng sinh nhật ${name}! Chúc bạn được làm điều mình thích, được ở cạnh người mình thương và được sống những ngày mà sau này nhìn lại vẫn thấy thật đáng nhớ.',
  'Chúc mừng sinh nhật ${name}! Hy vọng năm nay bạn sẽ gặt hái được thật nhiều thành quả từ những hạt giống chăm chỉ bạn đã gieo, và có thêm nhiều hạt giống mới để gieo tiếp.',
  'Gửi ${name} một lời chúc nhỏ nhưng chân thành: mong bạn luôn bình an. Vì khi lòng bình an, mọi điều khác rồi sẽ đến đúng lúc. Sinh nhật vui vẻ nha!',
  'Sinh nhật ${name} mà không chúc thì phí cả một năm chờ đợi! Chúc bạn tuổi mới cao thêm chút xíu, xinh đẹp thêm chút xíu và giỏi giang thêm thật nhiều!',
  'Chúc ${name} sinh nhật thật ý nghĩa! Cảm ơn bạn vì sự tận tâm trong từng việc nhỏ, chính những điều nhỏ bé ấy đã làm nên những chương trình thật lớn của SAB.',
  'Chúc ${name} một tuổi mới không cần hoàn hảo, chỉ cần trọn vẹn: trọn vẹn niềm vui, trọn vẹn sức khoẻ và trọn vẹn những khoảnh khắc bên người thân yêu.',
  'Ting ting! Bạn nhận được một lời chúc sinh nhật từ SAB. Nội dung: chúc ${name} tuổi mới vui vẻ, khoẻ mạnh, may mắn và thành công. Hạn sử dụng: mãi mãi!',
  'Chúc mừng sinh nhật ${name}! Dù hôm nay bạn ở đâu, đang làm gì, mong bạn biết rằng có cả một cộng đồng đang nghĩ về bạn và chúc bạn những điều tốt đẹp nhất.',
];

/**
 * How many wishes the quick.db bot had: its usage rows only ever name one of
 * these first entries, so an index at or past it in legacy data is bogus.
 */
export const LEGACY_BIRTHDAY_WISH_COUNT = 20;

export const BIRTHDAY_NAME_PLACEHOLDER = '${name}';

/** Fills every placeholder of a wish with the mention. */
export function renderBirthdayWish(wish: string, mention: string): string {
  return wish.replaceAll(BIRTHDAY_NAME_PLACEHOLDER, mention);
}
