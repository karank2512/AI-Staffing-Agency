/**
 * ~1,000 of the most frequently breached passwords and password *stems*, bundled so the policy works
 * offline (no API keys on this machine, and no network call belongs on the sign-up path).
 *
 * Entries are lower-cased stems, not literal passwords: `checkPasswordPolicy` also tests the candidate with
 * trailing digits/symbols stripped, with separators removed and with common leet substitutions undone, so
 * "P@ssw0rd!2024" is caught by the single entry "password". That is why short stems earn their place here
 * even though the length rule already rejects them on their own.
 *
 * Whitespace-separated so the source stays compact and diffable; parsed once into a Set at module load.
 */
const RAW = `
123456 123456789 12345678 12345 1234567 1234567890 123123 1234 111111 000000
666666 654321 121212 112233 123321 789456 159753 147258 987654321 11111111
222222 333333 444444 555555 777777 888888 999999 010203 123abc abc123
qwerty qwertyui qwertyuiop qwerty123 qwe123 qazwsx qazwsxedc zaq12wsx 1qaz2wsx 1q2w3e4r
1q2w3e4r5t 1qazxsw2 asdfgh asdfghjkl asdasd zxcvbn zxcvbnm poiuytrewq lkjhgfdsa mnbvcxz
qweasdzxc qwertz azerty wasd qwer1234 q1w2e3r4 a1b2c3d4 1234qwer 4321 abcd1234
password passwort passw0rd password1 password123 passwords pass123 mypassword newpassword changeme
letmein letmein123 welcome welcome1 welcome123 secret secret123 hello hello123 admin
administrator admin123 adminadmin root toor guest user username login logmein
master masterkey access access14 test test123 testing testtest temp temporary
default system manager superuser sysadmin webadmin operator service support helpdesk
iloveyou ilovegod iloveme loveme lovely love123 lover forever together forgetmenot
sunshine princess flower butterfly rainbow unicorn babygirl babyboy sweetie honey
angel angels angel123 chocolate cookie cupcake candy jellybean marshmallow lollipop
monkey monkey1 dragon dragon1 tigger tiger lion panther falcon eagle
phoenix hunter hunting fisher fishing shadow ghost spirit reaper ninja
samurai warrior soldier fighter ranger sniper gunner rambo maverick goose
football baseball basketball soccer hockey volleyball softball tennis golfing bowling
cricket rugby boxing wrestling skating surfing snowboard skateboard cycling running
liverpool arsenal chelsea barcelona realmadrid juventus manutd manchester everton tottenham
milan inter ajax bayern dortmund celtic rangers ferrari porsche lamborghini
corvette mustang camaro harley yamaha suzuki kawasaki honda toyota nissan
chevy chevrolet dodge subaru mercedes bentley maserati bugatti tesla jeep
superman batman spiderman ironman wolverine hulk thor avengers joker gotham
starwars startrek jedi skywalker vader yoda chewbacca r2d2 tatooine lightsaber
pokemon pikachu charizard digimon zelda mario luigi sonic tetris minecraft
fortnite roblox callofduty battlefield counterstrike halflife diablo starcraft warcraft wow
overwatch valorant leagueoflegends runescape everquest ultima skyrim fallout bioshock portal
matrix inception avatar titanic gladiator braveheart rocky terminator predator alien
harrypotter hogwarts gryffindor slytherin dumbledore hermione voldemort narnia hobbit gandalf
frodo legolas aragorn gollum mordor rivendell winterfell targaryen lannister khaleesi
metallica nirvana greenday linkinpark coldplay radiohead beatles rollingstones pinkfloyd ledzeppelin
guitar drummer bassist singer musician concert festival melody harmony rhythm
michael jennifer jessica ashley amanda brittany samantha sarah stephanie nicole
heather elizabeth megan melissa danielle rebecca laura emily michelle kimberly
christopher matthew joshua andrew daniel joseph william david richard thomas
charles anthony robert steven kevin brian jason justin ryan jacob
nicholas jonathan brandon tyler zachary dylan ethan austin benjamin samuel
alexander gabriel nathan christian caleb logan jackson mason hunter2 aiden
olivia sophia isabella charlotte amelia harper evelyn abigail madison chloe
victoria grace lillian natalie hannah zoey aubrey addison layla brooklyn
maria jose juan carlos luis miguel antonio manuel francisco pedro
rodrigo alejandro fernando ricardo eduardo roberto sergio andres diego mateo
mohamed mohammed ahmed mahmoud mustafa hassan hussein khalid abdullah omar
ivan sergey alexey dmitri andrei nikolai vladimir mikhail yuri boris
chen wang zhang liu yang huang zhao wu zhou xu
kumar singh patel sharma gupta verma reddy khan ali raja
smith johnson williams brown jones miller davis garcia wilson anderson
taylor thomasj moore martin jackson5 white harris clark lewis walker
family mother father brother sister daughter grandma grandpa auntie uncle
babycakes sweetheart darling beautiful gorgeous handsome pretty cutie boyfriend girlfriend
husband wifey married wedding anniversary valentine mylove myheart soulmate forever1
summer winter autumn spring january february march april june july
august september october november december monday friday saturday sunday holiday
newyork chicago houston dallas atlanta boston seattle denver miami vegas
orlando portland detroit memphis nashville baltimore milwaukee philly london paris
berlin madrid rome lisbon dublin amsterdam brussels vienna moscow kiev
warsaw prague budapest istanbul athens stockholm oslo helsinki tokyo osaka
kyoto beijing shanghai seoul bangkok manila jakarta singapore sydney melbourne
brisbane auckland toronto montreal vancouver calgary ottawa mexico canada america
usa england scotland ireland france germany italy spain brazil argentina
colombia chile peru india china japan korea australia russia poland
sweden norway denmark finland greece turkey egypt nigeria apple google
microsoft amazon facebook twitter instagram snapchat tiktok youtube netflix spotify
linkedin yahoo hotmail gmail outlook paypal ebay walmart samsung nokia
motorola blackberry android windows linux ubuntu macintosh iphone computer internet
website network server database firewall router modem wireless keyboard monitor
printer scanner laptop desktop tablet phone mobile digital programmer developer
engineer analyst designer architect consultant scientist teacher student school college
university campus library classroom homework diploma graduate degree company business
office work working job career employee boss money cash dollar
euro bitcoin crypto invest trading finance banking freedom liberty justice
peace truth honor loyalty courage wisdom strength victory champion winner
legend hero king queen prince princess1 happy happiness smile laugh
dream hope faith believe blessed grateful lucky luckyone luckydog luckycat
charmed magic magical wizard witch merlin red blue green yellow
orange purple pink black silver golden grey violet scarlet crimson
azure emerald sapphire ruby diamond pearl crystal marble granite copper
bronze platinum titanium steel water fire earth wind storm thunder
lightning rainy cloudy sunny ocean river lake mountain forest desert
island beach valley canyon garden flowers roses tulips daisy lily
jasmine orchid sunflower lavender apple123 orange1 banana cherry grape lemon
melon peach mango pineapple strawberry blueberry raspberry coconut avocado tomato
potato carrot pepper onion pizza burger hotdog taco sushi pasta
noodle sandwich pancake waffle coffee espresso latte cappuccino tea beer
wine whiskey vodka tequila whiskey1 brandy cognac martini mojito margarita
cocktail smoothie soda juice dog doggy puppy cat kitty kitten
bird parrot rabbit hamster horse pony cow sheep goat pig
chicken duck goose1 turkey1 fish shark whale dolphin octopus turtle
snake lizard frog spider bear wolf fox deer moose elephant
giraffe zebra rhino hippo freedom1 trustno1 nothing whatever whatever1 anything
something everything nobody somebody asshole bullshit fuckyou fuckme fucker shithead
bitches dammit crap idiot biteme blowme killer death die evil
devil demon satan hell heaven angelic holy jesus christ church
bible prayer amen gospel buddha allah karma zen yoga meditate
spiritual soul chakra mantra mydog mycat myname mylife myworld myhouse
mycar myjob myself mine qwerty1 qwerty12 letmein1 welcome2 access123 password12
admin1234 root1234 guest123 test1234 starwars1 football1 baseball1 soccer12 hockey12 jordan23
jordan michael23 kobe lebron messi ronaldo neymar beckham zidane pele
maradona federer nadal djokovic tigerwoods ferrari1 racing speed turbo nitro
rocket blaster thunder1 storm1 hacker hacking cracker phreak exploit rootkit
backdoor payload inject bypass security secure protect defender guardian shield
armor fortress bunker vault private secret1 hidden mystery enigma riddle
puzzle cipher encrypt decrypt alpha bravo charlie delta echo foxtrot
golf hotel juliet kilo lima oscar papa quebec romeo sierra
tango uniform victor xray yankee zulu omega sigma lambda gamma
theta epsilon matrix1 neo morpheus trinity oracle nebula galaxy cosmos
nova stellar saturn jupiter neptune mercury venus pluto orbit comet
meteor asteroid astronaut rocketman spaceship satellite telescope observatory universe infinity
eternal cosmic number1 first second third fourth fifth ninety eighty
seventy sixty 1985 1986 1987 1988 1989 1990 1991 1992
1993 1994 1995 1996 1997 1998 1999 2000 2001 2005
2010 2020 2021 2022 2023 2024 2025 1234512345 123456789a 12345678910
iloveyou1 iloveyou2 passion desire pleasure sexy sexy123 hotstuff naughty flirt
kisses hugs freedom2 usa1776 liberty1 eagle1 patriot veteran marine army
navy airforce ranger1 sergeant captain colonel general admiral commander lieutenant
corporal police sheriff trooper detective fireman doctor nurse dentist lawyer
judge pilot driver sailor farmer builder painter plumber baker butcher
barber chef waiter cashier clerk cleaner janitor guard porter courier
trucker happy123 smile123 sunny123 lucky123 magic123 super123 mega123 ultra123 power123
turbo123 superman1 batman1 spider1 hulk123 flash1 arrow1 titan giant colossus
goliath yankee1 dodger redsox cubbies giants packers steelers cowboys patriots
raiders broncos eagles1 falcons1 bengals chargers dolphins seahawks vikings saints
titans celtics lakers bulls heat spurs knicks nets warriors pistons
rockets mustang1 camaro1 corvette1 viper cobra stingray thunderbird firebird charger
challenger motorbike bicycle scooter skateboard1 rollerblade snowmobile jetski sailboat yacht
kayak camera photo picture selfie gallery album canvas palette sketch
drawing guitar1 piano violin drums trumpet saxophone flute banjo harmonica
cello reading writing poetry novel story chapter author writer reader
bookworm gaming gamer player console joystick controller headset stream twitch
discord chatting texting emailing calling meeting zooming posting sharing liking
following freedom123 whatever123 nothing123 something1 anybody everybody noone someone myself1
hotmail1 gmail123 yahoo123 webmail mailbox inbox outbox postbox letterbox mailman
carrot123 potato1 tomato1 pepper1 pickle cucumber lettuce spinach broccoli cabbage
sugar spice salty sweet sour bitter savory crunchy creamy tasty
dream123 dreamer dreaming nightmare daydream fantasy imagine wonder wonderland dreamland
`;

/** Lower-cased stems. A Set so the policy check is O(1) per candidate form. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  RAW.split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0),
);
